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
  const name = trim(body.name, 100);
  const contact = trim(body.contact, 180);
  const channel = trim(body.channel, 30);
  const wantsCompetitor = body.wantsCompetitor === true;
  const allowedChannels = ['email', 'telegram', 'whatsapp'];
  if (!fits(company, 2, 120)) throw Error('Укажите название компании (2–120 символов).');
  if (!fits(category, 3, 180)) throw Error('Укажите сферу деятельности компании.');
  if (!fits(name, 2, 100)) throw Error('Укажите ваше имя.');
  if (!allowedChannels.includes(channel)) throw Error('Выберите способ получения отчёта.');
  if (!fits(contact, 5, 180)) throw Error('Укажите, куда прислать результаты.');
  if (channel === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/u.test(contact)) {
    throw Error('Для электронной почты укажите корректный адрес.');
  }
  if (channel === 'whatsapp' && !/^\+?[\d\s()-]{10,25}$/.test(contact)) {
    throw Error('Для WhatsApp укажите номер телефона с кодом страны.');
  }
  if (channel === 'telegram' &&
      !/^(?:@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_+]{5,70}|[+]?[0-9\s()-]{10,25})$/i.test(contact)) {
    throw Error('Для Telegram укажите @имя, ссылку t.me или номер телефона.');
  }
  if (competitor.length > 120 || questions.length > 1000) {
    throw Error('Укоротите название конкурента или список вопросов.');
  }
  const site = normalizeDomain(body.site);
  const competitorSite = normalizeDomain(body.competitorSite, true);
  if (competitorSite && site === competitorSite) {
    throw Error('Сайт конкурента должен отличаться от сайта вашей компании.');
  }
  if (competitor || competitorSite) {
    if (!wantsCompetitor) throw Error('Отметьте сравнение с конкурентом или уберите его сведения.');
  }
  return {
    company, site, category, competitor, competitorSite,
    wantsCompetitor, questions, name, channel, contact
  };
}

function formatMessage(d) {
  const channel = {email:'Электронная почта',telegram:'Telegram',whatsapp:'WhatsApp'}[d.channel];
  return [
    '🔎 MIRVIX AI · Бесплатная проверка упоминаний в ИИ',
    '🌐 Заявка с публичной страницы /check/',
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
    '👤 Контактное лицо: ' + d.name,
    '📨 Получить отчёт: ' + channel,
    '📬 Контакт: ' + d.contact,
    '✅ Согласие с политикой конфиденциальности: получено',
    '🕒 Получено: ' + new Date().toISOString() + ' (UTC)'
  ].join('\n');
}

export default async function handler(request) {
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
  const token = process.env.MIRA_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.MIRA_TELEGRAM_CHAT_ID;
  if (!token || !chatId || !/^-?\d{5,22}$/.test(chatId)) {
    return respond({error:'Приём заявок временно недоступен. Отправьте заявку на mirvixai@mail.ru.'}, 503);
  }
  const message = formatMessage(prepared);
  if (message.length > 4096) return respond({error:'Заявка слишком длинная. Сократите список запросов.'}, 413);
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:message, disable_web_page_preview:true}),
      signal: AbortSignal.timeout(12000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      return respond({error:'Сервис приёма заявок не подтвердил доставку. Попробуйте снова или отправьте письмо.'}, 502);
    }
    return respond({submitted:true, message:'Заявка на бесплатную проверку отправлена.'});
  } catch {
    return respond({error:'Не удалось доставить заявку. Попробуйте снова или отправьте письмо.'}, 502);
  }
}

export const config = {
  path: '/api/ai-visibility-request',
  rateLimit: {windowLimit:3,windowSize:60,aggregateBy:['ip','domain']}
};

export const _test = {normalizeDomain, prepare, formatMessage};
