import {isStaffRequest} from '../lib/cabinet-session.mjs';
import crypto from 'node:crypto';

const PROVIDERS = Object.freeze({
  openai: { title: 'OpenAI (ответы API с веб-поиском)', env: 'OPENAI_API_KEY', model: 'gpt-5.5' },
  gemini: { title: 'Gemini (Google Search grounding)', env: 'GEMINI_API_KEY', model: 'gemini-3.8-flash' },
  perplexity: { title: 'Perplexity Sonar', env: 'PERPLEXITY_API_KEY', model: 'sonar' }
});

const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function respond(statusCode, body) {
  return { statusCode, headers: RESPONSE_HEADERS, body: JSON.stringify(body) };
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function passwordMatches(headers = {}) {
  const expected = process.env.MIRVIX_AUDIT_PASSWORD || '';
  const submitted = headers['x-mirvix-audit-key'] || headers['X-Mirvix-Audit-Key'] || '';
  if (typeof submitted !== 'string' || expected.length < 12 ||
      Buffer.byteLength(expected) !== Buffer.byteLength(submitted) ||
      Buffer.byteLength(expected) > 512) return false;
  return crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mentionIn(haystack, needles) {
  const normalized = ' ' + normalize(haystack) + ' ';
  return needles.some((raw) => {
    const term = normalize(raw);
    return term.length >= 4 && normalized.includes(' ' + term + ' ');
  });
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 1200) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username && !url.password && url.hostname ? url.href : null;
  } catch { return null; }
}

function uniqueSources(sources) {
  const output = [];
  const used = new Set();
  for (const candidate of sources) {
    const url = safeUrl(candidate?.url || candidate);
    if (!url || used.has(url)) continue;
    used.add(url);
    output.push({ url, title: text(candidate?.title, 110) || new URL(url).hostname });
    if (output.length >= 12) break;
  }
  return output;
}

function domainInSource(url, domain) {
  if (!domain) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const expected = domain.toLowerCase().replace(/^www\./, '');
    return hostname === expected || hostname.endsWith('.' + expected);
  } catch { return false; }
}

function validate(data) {
  const provider = text(data.provider, 30);
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Выберите подключённую нейросеть.');
  const prompt = text(data.prompt, 320);
  if (prompt.length < 12 || /[\r\n]/.test(prompt)) {
    throw new Error('Введите один естественный поисковый запрос (12–320 символов).');
  }
  const brand = text(data.brand, 120);
  if (brand.length < 3) throw new Error('Название компании должно содержать минимум 3 символа.');
  const aliases = Array.isArray(data.aliases)
    ? data.aliases.slice(0, 8).map((x) => text(x, 90)).filter((x) => x.length >= 4)
    : [];
  const competitors = Array.isArray(data.competitors)
    ? data.competitors.slice(0, 10).map((x) => text(x, 100)).filter((x) => x.length >= 4)
    : [];
  let domain = '';
  if (data.domain) {
    try {
      const raw = text(data.domain, 220);
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (url.username || url.password || url.port || !url.hostname.includes('.')) throw Error();
      domain = url.hostname.toLowerCase();
    } catch { throw new Error('Проверьте адрес сайта компании.'); }
  }
  return { provider, prompt, brand, aliases, competitors, domain };
}

async function requestJson(url, key, body, headers, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error('Провайдер не вернул корректный JSON-ответ.'); }
    if (!response.ok) {
      const detail = text(data?.error?.message || data?.message, 130);
      const hint = response.status === 401 || response.status === 403
        ? 'Проверьте API-ключ и права доступа.'
        : response.status === 429 ? 'Достигнут лимит запросов или средств.'
        : (response.status === 400 && detail ? detail : 'Повторите позже.');
      throw new Error('Ошибка ' + response.status + ' у провайдера: ' + hint);
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Провайдер не ответил вовремя. Попробуйте запрос повторно.');
    throw err;
  } finally { clearTimeout(timer); }
}

async function callOpenai(prompt, key) {
  const data = await requestJson('https://api.openai.com/v1/responses', key, {
    model: PROVIDERS.openai.model,
    input: prompt,
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    tool_choice: 'required',
    max_output_tokens: 1800,
    reasoning: { effort: 'low' },
    store: false,
    include: ['web_search_call.action.sources']
  }, { Authorization: 'Bearer ' + key });
  const sourceList = [];
  const answers = [];
  let searched = false;
  for (const entry of Array.isArray(data.output) ? data.output : []) {
    if (entry.type === 'web_search_call') {
      searched = true;
      for (const source of entry.action?.sources || []) sourceList.push({ url: source.url, title: source.title });
    }
    if (entry.type === 'message') {
      for (const block of entry.content || []) {
        if (typeof block.text === 'string') answers.push(block.text);
        for (const citation of block.annotations || []) {
          if (citation.url) sourceList.push({ url: citation.url, title: citation.title });
        }
      }
    }
  }
  return {
    answer: answers.join('\n').trim() || text(data.output_text, 10000),
    sources: uniqueSources(sourceList), searched, model: data.model || PROVIDERS.openai.model
  };
}

async function callGemini(prompt, key) {
  const data = await requestJson(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    key, {
      model: 'gemini-3.8-flash',
      input: prompt,
      tools: [{ type: 'google_search' }],
      generation_config: { max_output_tokens: 1500 }
    }, { 'x-goog-api-key': key }, 45000
  );
  const steps = Array.isArray(data.steps) ? data.steps :
    Array.isArray(data.interaction?.steps) ? data.interaction.steps : [];
  const lines = [];
  const references = [];
  let searched = false;
  for (const step of steps) {
    if (step.type === 'google_search_call') searched = true;
    if (step.type !== 'model_output') continue;
    for (const block of step.content || []) {
      if (block.type === 'text' && typeof block.text === 'string') lines.push(block.text);
      for (const item of block.annotations || []) {
        if (item.type === 'url_citation' && item.url)
          references.push({ url: item.url, title: item.title });
      }
    }
  }
  return {
    answer: text(data.output_text || data.interaction?.output_text, 12000) || lines.join('\n').trim(),
    sources: uniqueSources(references),
    searched,
    model: 'gemini-3.8-flash'
  };
}

async function callPerplexity(prompt, key) {
  const data = await requestJson(
    'https://api.perplexity.ai/v1/sonar', key, {
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1100,
      web_search_options: { search_mode: 'web' }
    }, { Authorization: 'Bearer ' + key }
  );
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const searchResults = Array.isArray(data.search_results) ? data.search_results : [];
  return {
    answer: data.choices?.[0]?.message?.content || '',
    sources: uniqueSources([
      ...citations.map((url) => ({ url })),
      ...searchResults.map((x) => ({ url: x.url, title: x.title }))
    ]),
    searched: citations.length > 0 || searchResults.length > 0,
    model: data.model || 'sonar'
  };
}

const CALL = Object.freeze({ openai: callOpenai, gemini: callGemini, perplexity: callPerplexity });

export async function handler(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Разрешён только POST.' });
  if (Buffer.byteLength(event.body || '') > 5000) return respond(413, { error: 'Слишком большой запрос.' });
  if (!isStaffRequest(event)) {
    return respond(401, { error: 'Неверный пароль внутреннего кабинета MIRVIX AI.' });
  }
  let request;
  try { request = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Неверный JSON.' }); }
  if (request.action === 'config') {
    return respond(200, {
      configured: Object.entries(PROVIDERS)
        .filter(([, item]) => !!process.env[item.env])
        .map(([id, item]) => ({ id, name: item.title, model: item.model })),
      providerNote: 'API-результаты; не идентичны персонализированным ответам приложений.'
    });
  }
  if (request.action !== 'query') return respond(400, { error: 'Неизвестная команда.' });
  let args;
  try { args = validate(request); }
  catch (err) { return respond(422, { error: err.message }); }
  const provider = PROVIDERS[args.provider];
  const key = process.env[provider.env];
  if (!key) return respond(503, { error: provider.title + ' пока не подключён: добавьте ' + provider.env + ' в Netlify.' });
  try {
    const started = Date.now();
    const data = await CALL[args.provider](args.prompt, key);
    if (!data.answer || !data.answer.trim()) {
      throw new Error('Модель вернула пустой ответ; проверка не засчитывается.');
    }
    const sources = data.sources.map((s) => ({
      ...s,
      companyDomain: domainInSource(s.url, args.domain)
    }));
    const competitorMentions = args.competitors.filter((name) => mentionIn(data.answer, [name]));
    return respond(200, {
      provider: args.provider,
      providerName: provider.title,
      model: data.model,
      prompt: args.prompt,
      brand: args.brand,
      answer: data.answer.slice(0, 12000),
      searched: data.searched,
      sources,
      brandMention: mentionIn(data.answer, [args.brand, ...args.aliases]),
      sourceMention: sources.some((s) => s.companyDomain),
      competitorsMentioned: competitorMentions,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      method: 'direct-api',
      caution: 'Отражает один ответ выбранного API, а не рейтинг или персонализированную выдачу пользовательского приложения.'
    });
  } catch (err) {
    return respond(502, { error: err?.message || 'Ошибка запроса к внешнему API.' });
  }
}

export const _test = { normalize, mentionIn, safeUrl, uniqueSources, domainInSource, validate, passwordMatches };
