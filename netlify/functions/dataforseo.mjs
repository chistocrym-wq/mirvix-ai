import { isStaffRequest } from '../lib/cabinet-session.mjs';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};
const reply = (statusCode, data) => ({statusCode, headers: HEADERS, body: JSON.stringify(data)});

function domain(value) {
  if (typeof value !== 'string' || value.length > 250 || !value.trim()) {
    throw new Error('Укажите домен сайта.');
  }
  const raw = value.trim();
  if (/[\s?#]/.test(raw)) throw new Error('Введите только адрес сайта, без параметров.');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); }
  catch { throw new Error('Некорректный домен сайта.'); }
  if (url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '') ||
      !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Укажите только домен сайта, без пути и номера порта.');
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host.length > 190 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)((?:localhost)|(?:local)|(?:internal)|(?:test)|(?:example)|(?:invalid))$/i.test(host)) {
    throw new Error('Укажите публичный домен.');
  }
  return host;
}

function credentials() {
  const login = process.env.DATAFORSEO_LOGIN || '';
  const password = process.env.DATAFORSEO_PASSWORD || '';
  if (!login || !password) return null;
  return Buffer.from(login + ':' + password, 'utf8').toString('base64');
}

async function provider(path, data, authorization) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 18000);
  try {
    const resp = await fetch('https://api.dataforseo.com/v3/' + path, {
      method: data === null ? 'GET' : 'POST',
      headers: {
        Authorization: 'Basic ' + authorization,
        Accept: 'application/json',
        ...(data !== null ? {'Content-Type': 'application/json'} : {})
      },
      ...(data !== null ? {body: JSON.stringify([data])} : {}),
      signal: ctrl.signal,
      redirect: 'error'
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error('DataForSEO отклонил доступ. Проверьте API Login, пароль и подтверждение аккаунта.');
      throw new Error('DataForSEO вернул HTTP ' + resp.status + '.');
    }
    const parsed = await resp.json();
    const code = parsed?.tasks?.[0]?.status_code || parsed?.status_code;
    if (parsed?.status_code !== 20000 || code !== 20000) {
      if (code === 40104 || parsed?.status_code === 40104) {
        throw new Error('Подтвердите учётную запись DataForSEO (код 40104) и повторите проверку.');
      }
      throw new Error('DataForSEO: ' + String(parsed?.tasks?.[0]?.status_message || parsed?.status_message || 'ошибка API').slice(0, 180) + ' (код ' + code + ').');
    }
    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('DataForSEO не ответил за 18 секунд.');
    throw err;
  } finally { clearTimeout(timeout); }
}

function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : null; }
function cost(x) { return Number(num(x) ?? 0); }

async function userData(auth) {
  const raw = await provider('appendix/user_data', null, auth);
  const item = raw?.tasks?.[0]?.result?.[0];
  if (!item) throw new Error('Нет данных аккаунта DataForSEO.');
  return { connected: true, balanceUsd: num(item.money?.balance), apiUserVerified: true, method: 'appendix/user_data', chargedUsd: cost(raw.cost) };
}

async function paid(action, target, auth) {
  const isKeywords = action === 'ranked-keywords';
  const endpoint = isKeywords
    ? 'dataforseo_labs/google/ranked_keywords/live'
    : 'dataforseo_labs/google/domain_rank_overview/live';
  // One task, one country, one language. Never request all countries or extra paid options.
  const request = {
    target,
    location_code: 2643,
    language_code: 'ru',
    limit: isKeywords ? 10 : 1
  };
  const raw = await provider(endpoint, request, auth);
  const firstTask = raw.tasks?.[0] || {};
  const result = firstTask.result?.[0] || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const common = {
    target,
    source: 'DataForSEO Labs / Google / Россия / ru',
    dataset: 'Собственная база DataForSEO; выборка, а не живой SERP',
    locationCode: 2643,
    languageCode: 'ru',
    checkedAt: new Date().toISOString(),
    chargedUsd: cost(raw.cost || firstTask.cost),
    totalItems: num(result.total_count),
    returnedItems: items.length,
    note: 'ETV и объём поискового трафика — оценки DataForSEO, не реальные визиты из Метрики.'
  };
  if (isKeywords) {
    return {
      ...common, action,
      keywords: items.map((i) => ({
        keyword: String(i.keyword_data?.keyword || '').slice(0, 180),
        volume: num(i.keyword_data?.keyword_info?.search_volume),
        position: num(i.ranked_serp_element?.serp_item?.rank_group),
        url: String(i.ranked_serp_element?.serp_item?.url || '').slice(0, 400),
        updatedAt: i.ranked_serp_element?.last_updated_time || i.keyword_data?.keyword_info?.last_updated_time || null
      }))
    };
  }
  const organic = items[0]?.metrics?.organic;
  const paidSearch = items[0]?.metrics?.paid;
  return {
    ...common, action,
    hasData: !!organic,
    metrics: organic ? {
      estimatedOrganicVisits: num(organic.etv),
      keywordsCount: num(organic.count),
      top1: num(organic.pos_1),
      top2to3: num(organic.pos_2_3),
      top4to10: num(organic.pos_4_10),
      top11to20: num(organic.pos_11_20),
      paidEstimatedVisits: num(paidSearch?.etv)
    } : null
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, {error:'Используйте POST.'});
  if (!isStaffRequest(event)) return reply(401, {error:'Войдите в кабинет как сотрудник MIRVIX AI.'});
  if (Buffer.byteLength(event.body || '', 'utf8') > 1500) return reply(413, {error:'Слишком большой запрос.'});
  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return reply(400, {error:'Неверный JSON.'}); }
  const auth = credentials();
  if (data.action === 'status') {
    if (!auth) return reply(200, {connected:false, configured:false, message:'В Netlify не заданы DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD или переменные недоступны этому Preview.'});
    try { return reply(200, {configured:true, ...await userData(auth)}); }
    catch(err) { return reply(502, {configured:true, connected:false, error:err.message}); }
  }
  if (!['domain-overview','ranked-keywords'].includes(data.action)) return reply(400, {error:'Неизвестная команда.'});
  if (!auth) return reply(503, {error:'DataForSEO пока не настроен для этого Preview.'});
  if (data.confirmPaid !== 'I_ACCEPT_API_COST') {
    return reply(403, {error:'Платный вызов требует отдельного подтверждения.'});
  }
  let target;
  try { target = domain(data.target); }
  catch (err) { return reply(422, {error:err.message}); }
  try { return reply(200, await paid(data.action, target, auth)); }
  catch (err) { return reply(502, {error:err.message}); }
}

export const _test = { domain };
