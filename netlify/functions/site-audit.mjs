import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const out = (code, data) => ({
  statusCode: code,
  headers: JSON_HEADERS,
  body: JSON.stringify(data)
});

function validateTarget(input) {
  if (typeof input !== 'string' || input.length > 240) throw new Error('Укажите публичный адрес сайта до 240 символов.');
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new Error('Введите адрес сайта без пробелов.');
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
  } catch {
    throw new Error('Адрес сайта не распознан. Пример: example.ru');
  }
  const h = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.port || parsed.hostname !== h || net.isIP(h) ||
      h === 'localhost' || !h.includes('.') ||
      /\.(local|internal|localhost|test|invalid|example)$/i.test(h) ||
      !/^[a-z0-9.-]+$/.test(h)) {
    throw new Error('Для проверки нужен публичный HTTPS-сайт с обычным доменным именем.');
  }
  return new URL('https://' + h + '/');
}

function publicIp(ip) {
  if (net.isIP(ip) === 4) {
    const x = ip.split('.').map(Number);
    return !(x[0] === 0 || x[0] === 10 || x[0] === 127 ||
      x[0] >= 224 || (x[0] === 169 && x[1] === 254) ||
      (x[0] === 172 && x[1] >= 16 && x[1] <= 31) ||
      (x[0] === 192 && x[1] === 168) ||
      (x[0] === 100 && x[1] >= 64 && x[1] <= 127) ||
      (x[0] === 192 && x[1] === 0) ||
      (x[0] === 198 && (x[1] === 18 || x[1] === 19)) ||
      (x[0] === 198 && x[1] === 51 && x[2] === 100) ||
      (x[0] === 203 && x[1] === 0 && x[2] === 113));
  }
  if (net.isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) {
      const embedded = v.slice(7);
      return net.isIP(embedded) === 4 && publicIp(embedded);
    }
    return !(v === '::' || v === '::1' || v.startsWith('fc') ||
      v.startsWith('fd') || v.startsWith('fe8') ||
      v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') ||
      v.startsWith('2001:db8'));
  }
  return false;
}

async function checkHost(url) {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Недопустимое перенаправление сайта.');
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || net.isIP(host) ||
      /\.(local|internal|localhost|test|invalid|example)$/i.test(host)) {
    throw new Error('Проверка локальных адресов запрещена.');
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !publicIp(item.address))) {
    throw new Error('Сайт не имеет подтверждённого публичного адреса.');
  }
  // Prefer a validated IPv4 record: serverless runtimes may not route IPv6 reliably.
  return addresses.find((item) => item.family === 4) || addresses[0];
}

// DNS is pinned to a publicly validated IP. In modern Node.js, HTTPS
// may ask the custom lookup() callback for { all: true }; that callback
// MUST return an array, otherwise net.connect raises Invalid IP address: undefined.
function pinnedLookup(resolved) {
  return (_hostname, options, callback) => {
    if (options && options.all) {
      callback(null, [{ address: resolved.address, family: resolved.family }]);
    } else {
      callback(null, resolved.address, resolved.family);
    }
  };
}

// DNS answer is pinned to the HTTPS socket. Rebinding cannot silently
// re-resolve the hostname to localhost or a private address on fetch().
async function pinnedFetch(url, limit, timeoutMs = 14000) {
  const resolved = await checkHost(url);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (err) reject(err);
      else resolve(value);
    };
    const guard = setTimeout(() => request.destroy(new Error('Превышено время автоматической проверки (' + Math.ceil(timeoutMs/1000) + ' с).')), timeoutMs);
    const request = https.request(url, {
      method: 'GET',
      agent: false,
      timeout: timeoutMs,
      lookup: pinnedLookup(resolved),
      headers: {
        'user-agent': 'MIRVIX-Audit/1.1 (+https://mirvixai.com/audit/)',
        accept: 'text/html,application/xml,text/plain;q=0.9,*/*;q=0.5'
      }
    }, (response) => {
      const chunks = [];
      let received = 0;
      const done = () => finish({
        status: response.statusCode || 0,
        text: Buffer.concat(chunks).toString('utf8'),
        headers: { get: (name) => response.headers[name.toLowerCase()] || '' },
        url: url.href
      });
      response.on('data', (chunk) => {
        if (received >= limit) return;
        const portion = chunk.subarray(0, Math.max(0, limit - received));
        if (portion.length) chunks.push(portion);
        received += portion.length;
        if (received >= limit) {
          done();
          response.destroy();
        }
      });
      response.on('end', done);
      response.on('error', (err) => { if (!settled) finish(null, err); });
    });
    request.on('timeout', () => request.destroy(new Error('Превышено время автоматической проверки (' + Math.ceil(timeoutMs/1000) + ' с).')));
    request.on('error', (err) => finish(null, err));
    request.end();
  });
}

async function getText(start, limit = 950000, timeoutMs = 14000) {
  let current = start;
  const root = start.hostname.replace(/^www\./, '');
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop < 4; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) throw new Error('Превышено время автоматической проверки (' + Math.ceil(timeoutMs/1000) + ' с).');
    const response = await pinnedFetch(current, limit, remaining);
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = new URL(response.headers.get('location'), current);
      if (next.protocol !== 'https:' || next.port || next.username || next.password ||
          next.hostname.replace(/^www\./, '') !== root) {
        throw new Error('Сайт перенаправляет на другой домен. Введите итоговый HTTPS-адрес.');
      }
      current = next;
      continue;
    }
    return response;
  }
  throw new Error('Слишком много перенаправлений.');
}

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
const match = (s, re) => (s.match(re) || [,''])[1] || '';
function attributes(tag) {
  const a = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}

function extract(html) {
  const head = match(html, /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i) || html.slice(0, 30000);
  const title = clean(match(head, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i));
  const metas = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    if (a.name || a.property) metas[(a.name || a.property).toLowerCase()] = a.content || '';
  }
  const links = {};
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    if (a.rel) links[a.rel.toLowerCase()] = a.href || '';
  }
  const lang = attributes(match(html, /(<html\b[^>]*>)/i)).lang || '';
  const content = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const h1s = [...content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
    .map((m) => clean(m[1])).filter(Boolean).slice(0, 12);
  const jsonld = (html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi) || []).length;
  const tel = /href\s*=\s*["']tel:/i.test(html);
  const brandContent = clean(content.slice(0, 200000));
  return { title, description: metas.description || '', h1s, lang,
    canonical: links.canonical || '', viewport: metas.viewport || '',
    robotsMeta: [metas.robots || '', metas.googlebot || '', metas.yandex || ''].filter(Boolean).join('; '),
    openGraph: !!(metas['og:title'] && metas['og:description']),
    jsonld, tel, brandContent };
}

function robotsDecision(content, name, path = '/') {
  if (!content) return null;
  const groups = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const value = line.split('#')[0].trim();
    const pos = value.indexOf(':');
    if (pos < 0) continue;
    const key = value.slice(0, pos).trim().toLowerCase();
    const val = value.slice(pos + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ key, val });
    }
  }
  const crawler = name.toLowerCase();
  let maxAgentLength = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent !== '*' && crawler.startsWith(agent)) {
        maxAgentLength = Math.max(maxAgentLength, agent.length);
      }
    }
  }
  const selected = groups.filter((g) => g.agents.some((agent) =>
    maxAgentLength >= 0
      ? agent !== '*' && crawler.startsWith(agent) && agent.length === maxAgentLength
      : agent === '*'));
  const escapeRegex = (segment) => Array.from(segment).map((ch) =>
    '.+?^$()[]{}|\\'.includes(ch) ? '\\' + ch : ch).join('');
  let winner = null;
  for (const group of selected) {
    for (const rule of group.rules) {
      if (!rule.val) continue; // Empty Disallow never blocks anything
      const end = rule.val.endsWith('$');
      const raw = end ? rule.val.slice(0, -1) : rule.val;
      try {
        const pattern = '^' + raw.split('*').map(escapeRegex).join('.*') + (end ? '$' : '');
        if (!new RegExp(pattern).test(path)) continue;
        const specificity = raw.replace(/\*/g, '').length + (end ? 1 : 0);
        if (!winner || specificity > winner.specificity ||
            (specificity === winner.specificity && rule.key === 'allow')) {
          winner = { ...rule, specificity };
        }
      } catch { /* Unsupported malformed directive; do not make a negative claim */ }
    }
  }
  return {
    blocked: !!winner && winner.key === 'disallow',
    rule: winner ? winner.key.charAt(0).toUpperCase() + winner.key.slice(1) + ': ' + winner.val :
      'Нет правила, запрещающего главную страницу',
    group: maxAgentLength >= 0 ? 'специальная группа ' + name : 'общая группа *',
    scope: 'Только правила robots.txt для URL /; доступность HTML и реальный обход не измерены.'
  };
}

function botBlocked(content, name) {
  return robotsDecision(content, name)?.blocked ?? null;
}

function check(id, title, ok, detail, tip, importance = 'medium') {
  const htmlOnly = ['index','title','description','h1','canonical','lang','viewport','structured','og'];
  return { id, title, state: ok === null ? 'unknown' : ok ? 'ok' : 'issue',
    detail: ok === null && htmlOnly.includes(id)
      ? 'Нет данных: HTML главной страницы не получен. Нельзя судить о наличии или отсутствии элемента.'
      : String(detail || '').slice(0, 240),
    tip: ok === null || ok ? '' : tip, importance };
}

function resourceFileState(reply, valid) {
  if (!reply || [401,403,408,429].includes(reply.status) || reply.status >= 500) return 'unknown';
  if (reply.status === 404 || reply.status === 410) return 'missing';
  if (reply.status === 200) return valid ? 'ok' : 'unknown';
  return 'unknown';
}
function partialResourceInfo(reply, error, label) {
  if (reply?.status === 401 || reply?.status === 403) return 'HTTP ' + reply.status + ': сайт не предоставил файл автоматическому аудитору';
  if (reply?.status === 429) return 'HTTP 429: ограничено число автоматических запросов';
  if (reply && reply.status >= 500) return 'HTTP ' + reply.status + ': ошибка сервера при получении ' + label;
  if (reply) return 'HTTP ' + reply.status;
  return error?.message || 'Не удалось получить ' + label;
}

async function audit(raw, brand) {
  const start = validateTarget(raw);
  const startMs = Date.now();
  // Every resource is independent: a blocked home page must not hide available robots or sitemap.
  const targets = [
    {url:start, limit:800000, timeout:10000, label:'главную страницу'},
    {url:new URL('/robots.txt',start), limit:140000, timeout:8500, label:'robots.txt'},
    {url:new URL('/sitemap.xml',start), limit:180000, timeout:8500, label:'sitemap.xml'},
    {url:new URL('/llms.txt',start), limit:90000, timeout:8500, label:'llms.txt'}
  ];
  const settled = await Promise.allSettled(targets.map(t=>getText(t.url,t.limit,t.timeout)));
  const item = i => settled[i].status === 'fulfilled' ? settled[i].value : null;
  const error = i => settled[i].status === 'rejected' ? settled[i].reason : null;
  const homepage = item(0), robots = item(1), sitemap = item(2), llms = item(3);
  const elapsedMs = Date.now() - startMs;
  const htmlOk = !!(homepage && homepage.status >= 200 && homepage.status < 300 &&
    /<html\b/i.test(homepage.text));
  const homepageMessage = htmlOk ? ('HTTP '+homepage.status+' · '+homepage.url) :
    partialResourceInfo(homepage,error(0),'главную страницу');
  const tags = extract(htmlOk ? homepage.text : '');
  const robotsAvailable = !!(robots && robots.status === 200 && /user-agent\s*:/i.test(robots.text));
  let finalMap = sitemap;
  const sitemapDeclared = robotsAvailable ? match(robots.text, /^\s*Sitemap:\s*(\S+)/im) : '';
  if (!(sitemap && sitemap.status === 200 && /<\??(?:urlset|sitemapindex)\b/i.test(sitemap.text)) && sitemapDeclared) {
    try {
      const declaredUrl = new URL(sitemapDeclared);
      if (declaredUrl.origin === start.origin && declaredUrl.protocol === 'https:') {
        finalMap = await getText(declaredUrl, 200000);
      }
    } catch { /* Sitemap declaration may be invalid. */ }
  }
  const sitemapOk = !!(finalMap && finalMap.status === 200 &&
    /<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(finalMap.text));
  const botNames = ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Googlebot', 'Bingbot'];
  const botAccess = botNames.map((name) => {
    const decision = robotsAvailable ? robotsDecision(robots.text, name, '/') : null;
    return { name, state: decision ? (decision.blocked ? 'blocked' : 'not-blocked') : 'unknown',
      rule: decision?.rule || '', group: decision?.group || '',
      note: 'Правила robots.txt для главной страницы. Не подтверждает доступность HTML или фактический обход.' };
  });
  const access = (name) => botAccess.find((b) => b.name === name);
  const llmsOk = !!(llms && llms.status === 200 && llms.text.trim() &&
    !/<html\b/i.test(llms.text) && !/<!doctype html/i.test(llms.text));
  const root = start.origin;
  const files = [
    { id:'robots', name:'robots.txt', url: root + '/robots.txt',
      state: resourceFileState(robots, robotsAvailable),
      httpStatus: robots?.status ?? null, required: false,
      note: 'Файл правил для поисковых роботов. Его отсутствие само по себе не запрещает обход.' },
    { id:'sitemap', name:'sitemap.xml', url: finalMap?.url || root + '/sitemap.xml',
      state: resourceFileState(finalMap, sitemapOk),
      httpStatus: finalMap?.status ?? null, required: false,
      note: 'Полезная XML-карта адресов; помогает обнаружению страниц, но не гарантирует индексацию.' },
    { id:'llms', name:'llms.txt', url: root + '/llms.txt',
      state: resourceFileState(llms, llmsOk),
      httpStatus: llms?.status ?? null, required: false, optional: true,
      note: 'Необязательная экспериментальная подсказка для ИИ-агентов, не условие присутствия в ChatGPT.' }
  ];
  const noindex = htmlOk ? /\bnoindex\b/i.test(tags.robotsMeta + '; ' + (homepage.headers.get('x-robots-tag') || '')) : null;
  const brandFound = brand && htmlOk ? tags.brandContent.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) ||
    tags.title.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) : null;
  const checks = [
    check('response','Доступ главной страницы по HTTPS', htmlOk ? true : (homepage && homepage.status === 404 ? false : null), homepageMessage, 'Проверить доступность главной страницы с разрешённого клиента; коды 401/403 и тайм-ауты не являются оценкой SEO.', 'high'),
    check('index','Индексация не запрещена', htmlOk ? !noindex : null, noindex ? 'Найдено указание noindex.' : 'Явных директив noindex в HTML и HTTP-заголовках нет.',
      'Проверить meta robots и X-Robots-Tag: поисковики могут игнорировать страницу.', 'high'),
    check('title','Заголовок страницы (title)', htmlOk ? !!tags.title : null, tags.title || 'Тег title не обнаружен.',
      'Добавить уникальный title с услугой, городом и названием компании.', 'high'),
    check('description','Описание (meta description)', htmlOk ? !!tags.description : null, tags.description || 'Метаописание не обнаружено.',
      'Подготовить ясное описание услуг и преимуществ компании.', 'medium'),
    check('h1','Основной заголовок H1', htmlOk ? tags.h1s.length > 0 : null, tags.h1s.length ? tags.h1s.join(' | ') : 'H1 не найден.',
      'Добавить видимый заголовок H1 о ключевой услуге.', 'medium'),
    check('canonical','Канонический адрес', htmlOk ? !!tags.canonical : null, tags.canonical || 'Canonical не обнаружен.',
      'Добавить rel=canonical на основную версию страницы.', 'medium'),
    check('lang','Язык страницы', htmlOk ? !!tags.lang : null, tags.lang ? 'lang="' + tags.lang + '"' : 'Атрибут lang не найден.',
      'Задать атрибут lang у HTML.', 'low'),
    check('viewport','Мобильная адаптация (viewport)', htmlOk ? !!tags.viewport : null, tags.viewport || 'Viewport не найден.',
      'Добавить meta viewport и проверить реальное отображение на телефоне.', 'medium'),
    check('robots','Файл robots.txt', resourceFileState(robots,robotsAvailable)==='unknown'?null:robotsAvailable,
      robots === null ? 'Не удалось получить robots.txt.' : robotsAvailable ? 'Доступен: ' + start.origin + '/robots.txt' : 'HTTP ' + robots.status + ': robots.txt недоступен или не распознан. Это не всегда ошибка сайта.',
      'Создать или проверить robots.txt. Это рекомендация, не обязательное условие индексации.', 'medium'),
    check('sitemap','XML-карта сайта', resourceFileState(finalMap,sitemapOk)==='unknown'?null:sitemapOk,
      finalMap === null ? 'Не удалось проверить sitemap.' : sitemapOk ? 'XML-карта сайта найдена.' : 'HTTP ' + finalMap.status + ': XML-карта не подтверждена. Не делайте вывод об отсутствии файла без проверки.',
      'Создать sitemap.xml и указать его в robots.txt и кабинетах вебмастеров.', 'medium'),
    check('structured','Структурированные данные JSON-LD', htmlOk ? tags.jsonld > 0 : null, tags.jsonld ? 'Найдено JSON-LD блоков: ' + tags.jsonld + '. Корректность данных не проверялась.' : 'JSON-LD на главной не найден.',
      'Добавить достоверную разметку Organization, LocalBusiness или подходящий тип Schema.org.', 'medium'),
    check('og','Превью для социальных сетей', htmlOk ? tags.openGraph : null, tags.openGraph ? 'Найдены Open Graph title и description.' : 'Не обнаружена полная пара og:title / og:description.',
      'Настроить Open Graph для корректного отображения ссылок.', 'low'),
    ...[
      ['OAI-SearchBot','OAI-SearchBot (ChatGPT Search)','airobots'],
      ['PerplexityBot','PerplexityBot','bot-perplexitybot'],
      ['Claude-SearchBot','Claude-SearchBot','bot-claude-searchbot'],
      ['Googlebot','Googlebot','bot-googlebot'],
      ['Bingbot','Bingbot','bot-bingbot']
    ].map(([agent, title, id]) => {
      const entry = access(agent);
      return check(id,title,entry.state === 'unknown' ? null : entry.state === 'not-blocked',
        entry.state === 'unknown' ? 'Не удалось получить или разобрать robots.txt.' :
        (entry.state === 'blocked' ? 'Запрет главной страницы по правилу ' : 'Запрета главной страницы не найдено; применено правило: ') + entry.rule,
        'Проверить разрешения ' + agent + ' в robots.txt. Действие правил не гарантирует фактический обход сайта.', 'high');
    })
  ];
  const known = checks.filter((c) => c.state !== 'unknown');
  const passed = known.filter((c) => c.state === 'ok').length;
  const issues = checks.filter((c) => c.state === 'issue');
  const recommendations = issues.slice().sort((a, b) => (
    { high: 0, medium: 1, low: 2 }[a.importance] -
    { high: 0, medium: 1, low: 2 }[b.importance]
  )).slice(0, 7).map((x) => ({ title: x.title, text: x.tip, importance: x.importance }));
  if (!recommendations.length) recommendations.push({
    title: 'Контент, отзывы и внешние упоминания',
    text: 'Следующий этап — проверить реальные запросы в нейросетях, карточки организации и цитируемые источники.',
    importance: 'medium'
  });
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    source: 'Независимая проверка главной страницы и служебных файлов; правила robots.txt проверены только для URL /',
    domain: start.hostname, url: homepage?.url || start.href, brand: brand || '', httpStatus: homepage?.status ?? null,
    partial: !htmlOk, homepageMessage,
    resourceChecks: targets.map((t,i)=>({name:t.label,url:t.url.href,httpStatus:item(i)?.status ?? null,message:partialResourceInfo(item(i),error(i),t.label)})),
    elapsedMs,
    score: htmlOk ? Math.round((passed / Math.max(known.length, 1)) * 100) : null,
    checked: known.length, passed, issuesCount: issues.length,
    unknown: checks.filter((x) => x.state === 'unknown').length,
    checks, recommendations, files, botAccess,
    extras: { brandFound, h1Count: tags.h1s.length, title: tags.title, description: tags.description,
      phoneLink: tags.tel, jsonldCount: tags.jsonld },
    caveat: 'Если главная страница недоступна для аудитора, общий балл не рассчитывается. Отдельные служебные файлы могут быть проверены независимо. Аудит не измеряет позиции и упоминания в ИИ.'
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { allow: 'POST' }, body: '' };
  if (event.httpMethod !== 'POST') return out(405, { error: 'Используйте POST.' });
  if ((event.body || '').length > 2500) return out(413, { error: 'Слишком большой запрос.' });
  try {
    const data = JSON.parse(event.body || '{}');
    const brand = typeof data.brand === 'string' ? data.brand.trim().slice(0, 120) : '';
    const report = await audit(data.url, brand);
    return out(200, report);
  } catch (err) {
    return out(422, { error: err?.message || 'Не удалось выполнить аудит.' });
  }
};

export const _test = { validateTarget, publicIp, extract, botBlocked, robotsDecision, pinnedLookup, audit };
