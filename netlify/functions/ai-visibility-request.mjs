import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { isStaffRequest } from '../lib/cabinet-session.mjs';
// Public, explicitly confirmed FREE AI-visibility request -> MIRVIX team Telegram.
// Does not run paid AI APIs, does not collect payment, and never stores contacts in a database.
// Uses existing MIRA_TELEGRAM_BOT_TOKEN + MIRA_TELEGRAM_CHAT_ID server-only secrets.
const respond = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }
});

const trim = (input, max) => typeof input === 'string' ? input.trim().slice(0, max + 1) : '';
const fits = (input, min, max) => input.length >= min && input.length <= max;
const SERVICES = Object.freeze({
  'ai-visibility': 'Проверка упоминаний компании в нейросетях',
  'product-comparison': 'Сравнение карточек товаров, цен и ассортимента',
  'technical-audit': 'Технический аудит сайта по 22 критериям',
  'prompt-matrix': 'Матрица покупательских запросов',
  'competitors-ai': 'Конкуренты в ответах ИИ',
  'geo-monitoring': 'Мониторинг упоминаний и GEO-рейтинг',
  'geo-content': 'Рекомендации и контент для GEO',
  'price-monitoring': 'Отслеживание цен и ассортимента',
  'seo-competition': 'Сравнение поисковой видимости и конкурентов'
});

function normalizeDomain(raw, optional = false) {
  if (!raw && optional) return '';
  if (typeof raw !== 'string' || raw.length > 240 || !raw.trim()) {
    throw Error('Укажите ссылку на сайт компании.');
  }
  let parsed;
  try {
    const value = raw.trim();
    parsed = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
  } catch {
    throw Error('Укажите корректный адрес сайта.');
  }
  if (!['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username || parsed.password || parsed.port ||
      parsed.search || parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      !parsed.hostname.includes('.') || parsed.hostname.length > 190 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(parsed.hostname)) {
    throw Error('Для сайта укажите домен без пути, логина или параметров, например company.ru.');
  }
  return parsed.hostname.toLowerCase().replace(/^www\./, '');
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

function prepare(body) {
  if (!body || body.consent !== true) throw Error('Подтвердите согласие на обработку данных заявки.');
  const company = trim(body.company, 120);
  const category = trim(body.category, 180);
  const competitor = trim(body.competitor, 120);
  const questions = trim(body.questions, 1000);
  const productLinks = trim(body.productLinks, 1000);
  const service = typeof body.service === 'string' && body.service
    ? body.service.trim() : 'ai-visibility';
  if (!Object.hasOwn(SERVICES, service)) throw Error('Неизвестный вид проверки.');
  const name = trim(body.name, 100);
  const contact = trim(body.contact, 180);
  const channel = trim(body.channel, 30);
  const wantsCompetitor = body.wantsCompetitor === true;
  const allowedChannels = ['email', 'telegram'];
  if (!fits(company, 2, 120)) throw Error('Укажите название компании (2–120 символов).');
  if (!fits(category, 3, 180)) throw Error('Укажите сферу деятельности компании.');
  if (!fits(name, 2, 100)) throw Error('Укажите ваше имя.');
  if (!allowedChannels.includes(channel)) throw Error('Выберите способ получения отчёта.');
  if (!fits(contact, 5, 180)) throw Error('Укажите, куда прислать результаты.');
  if (channel === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/u.test(contact)) {
    throw Error('Для электронной почты укажите корректный адрес.');
  }
  if (channel === 'telegram' &&
      !/^(?:@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_+]{5,70}|[+]?[0-9\s()-]{10,25})$/i.test(contact)) {
    throw Error('Для Telegram укажите @имя, ссылку t.me или номер телефона.');
  }
  if (competitor.length > 120 || questions.length > 1000 || productLinks.length > 1000) {
    throw Error('Укоротите название конкурента или список вопросов.');
  }
  const site = normalizeDomain(body.site);
  const competitorSite = normalizeDomain(body.competitorSite, true);
  if (competitorSite && site === competitorSite) {
    throw Error('Сайт конкурента должен отличаться от сайта вашей компании.');
  }
  return {
    company, site, category, competitor, competitorSite,
    wantsCompetitor: wantsCompetitor || !!competitor || !!competitorSite,
    questions, productLinks, service, name, channel, contact
  };
}

function formatMessage(d) {
  const channel = {email:'Электронная почта',telegram:'Telegram'}[d.channel];
  return [
    '🔎 MIRVIX AI · Новая заявка на бесплатный отчёт',
    '📋 Вид анализа: ' + SERVICES[d.service],
    '🌐 Заявка с публичной страницы ' + (d.service === 'ai-visibility' ? '/check/' : '/tools/'),
    '',
    '🏢 Компания: ' + d.company,
    '🌐 Сайт: ' + d.site,
    '📌 Чем занимается: ' + d.category,
    '',
    '🔍 Проверить конкурента: ' + (d.wantsCompetitor ? 'да' : 'нет'),
    '🏷 Конкурент: ' + (d.competitor || 'не указан'),
    '🔗 Сайт конкурента: ' + (d.competitorSite || 'не указан'),
    '',
    '❓ Пожелания к запросам:',
    d.questions || 'Не указаны — подобрать по деятельности',
    '',
    '🛒 Ссылки на товары / дополнительные сведения:',
    d.productLinks || 'Не указаны',
    '',
    '👤 Контактное лицо: ' + d.name,
    '📨 Получить отчёт: ' + channel,
    '📬 Контакт: ' + d.contact,
    '✅ Согласие с политикой конфиденциальности: получено',
    '🕒 Получено: ' + new Date().toISOString() + ' (UTC)'
  ].join('\n');
}

function leadsStore() {return getStore({name:'mirvix-free-ai-inbox',consistency:'strong'});}
function uid(value) {return typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value)?value:randomUUID();}
async function saveLead(key,prepared) {
  const store=leadsStore();
  const old=await store.get('leads/'+key,{type:'json',consistency:'strong'});
  if(old) return old;
  const item={id:key,createdAt:new Date().toISOString(),...prepared,status:'received',notification:'pending'};
  await store.setJSON('leads/'+key,item);
  return item;
}
async function listLeads(request) {
  const url=new URL(request.url);
  const headers=Object.fromEntries(request.headers.entries());
  if(!isStaffRequest({headers:{...headers,host:url.host}})) return respond({error:'Требуется вход сотрудника MIRVIX.'},403);
  const store=leadsStore();
  const index=await store.list({prefix:'leads/',paginate:false});
  const keys=(index.blobs||[]).slice(-120);
  const rows=(await Promise.all(keys.map(x=>store.get(x.key,{type:'json',consistency:'strong'})))).filter(Boolean)
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  return respond({leads:rows.slice(0,100)});
}
export default async function handler(request) {
  if (request.method==='GET') return new URL(request.url).searchParams.get('action')==='list'
    ? listLeads(request) : respond({error:'Используйте POST.'},405);
  if (request.method !== 'POST') return respond({error:'Используйте POST.'}, 405);
  if (!sameOrigin(request)) return respond({error:'Недопустимый источник запроса.'}, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return respond({error:'Ожидается JSON.'}, 415);
  }
  if (Number(request.headers.get('content-length')) > 7500) {
    return respond({error:'Слишком длинная заявка.'}, 413);
  }
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 7500) return respond({error:'Слишком длинная заявка.'}, 413);
    data = JSON.parse(raw);
  } catch {
    return respond({error:'Не удалось прочитать заявку.'}, 400);
  }
  if (data?.extra_url) return respond({submitted:true}, 200); // non-visible honeypot
  let prepared;
  try { prepared = prepare(data); }
  catch (error) { return respond({error:error.message}, 422); }
  // Persist first: an unavailable Telegram bot must never silently discard an accepted form.
  const leadId=uid(data.requestId);
  let saved;
  try { saved=await saveLead(leadId,prepared); }
  catch {return respond({error:'Сервер не смог надёжно сохранить заявку. Напишите на mirvixai@mail.ru.'},503);}
  if(saved.notification==='delivered')return respond({submitted:true,requestId:leadId,notified:true,message:'Заявка уже получена.'});
  const token=process.env.MIRA_TELEGRAM_BOT_TOKEN;
  const chatId=process.env.MIRA_TELEGRAM_CHAT_ID;
  if (!token || !chatId || !/^-?\\d{5,22}$/.test(chatId)) {
    return respond({submitted:true,requestId:leadId,notified:false,message:'Заявка сохранена. Уведомление команде пока недоступно.'},202);
  }
  const message=formatMessage(prepared);
  if(message.length>4096)return respond({submitted:true,requestId:leadId,notified:false,message:'Заявка сохранена, уведомление будет обработано отдельно.'},202);
  try {
    const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true}),
      signal:AbortSignal.timeout(12000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||result?.ok!==true) return respond({submitted:true,requestId:leadId,notified:false,message:'Заявка сохранена. Уведомление команде задерживается.'},202);
    try {await leadsStore().setJSON('leads/'+leadId,{...saved,notification:'delivered',notifiedAt:new Date().toISOString()});}
    catch { /* Telegram confirmed delivery: avoid retry to prevent duplicate messages. */ }
    return respond({submitted:true,requestId:leadId,notified:true,message:'Заявка успешно получена и передана специалисту.'});
  } catch {
    return respond({submitted:true,requestId:leadId,notified:false,message:'Заявка сохранена. Уведомление команде задерживается.'},202);
  }
}

export const config = {
  path: '/api/ai-visibility-request',
  rateLimit: {windowLimit:3,windowSize:60,aggregateBy:['ip','domain']}
};

export const _test = {normalizeDomain, prepare, formatMessage};
