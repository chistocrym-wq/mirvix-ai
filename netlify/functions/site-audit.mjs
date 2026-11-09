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
  const schemaBlocks = [...html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  let organizationSchema = false, sameAsCount = 0, validJsonLd = 0;
  const schemaWalk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(schemaWalk);
    const types = [node['@type']].flat().map(x => String(x || '').split('/').pop().toLowerCase());
    if (types.some(x => /^(organization|localbusiness|store|corporation|onlinestore|hardwarestore|homegoodsstore)$/.test(x))) {
      organizationSchema = true;
      sameAsCount += [node.sameAs].flat().filter(x => typeof x === 'string' && /^https?:\/\//.test(x)).length;
    }
    if (node['@graph']) schemaWalk(node['@graph']);
  };
  for (const block of schemaBlocks) {
    try { const data = JSON.parse(block[1]); validJsonLd++; schemaWalk(data); } catch { /* Malformed JSON-LD is not affirmative evidence. */ }
  }
  const body = match(content, /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i) || content;
  const main = match(body, /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i) || body;
  const withoutDecor = main.replace(/<(?:nav|header|footer|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|svg|noscript)\s*>/gi, ' ');
  const plain = withoutDecor.replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = (value) => (String(value || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const headings = [...main.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]\s*>/gi)].map(x => clean(x[1])).filter(Boolean);
  const questionHeadings = headings.filter(x => /[?？]/.test(x) ||
    /^(как|где|что|зачем|почему|сколько|какой|какая|какие|когда|можно ли|how|where|what|why|which|when)\b/iu.test(x));
  const firstParagraph = clean(match(main, /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i));
  const firstParagraphWords = wordCount(firstParagraph);
  const visibleWords = wordCount(plain);
  const hasFaq = /"@type"\s*:\s*"FAQPage"/i.test(html) ||
    /(часто задаваемые вопросы|вопросы и ответы|frequently asked questions|\bfaq\b)/iu.test(plain.slice(0, 18000));
  const hasContact = /href\s*=\s*["'](?:tel:|mailto:)/i.test(body) ||
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(plain) ||
    /(?:\+?\d[\d\s().-]{9,}\d)/.test(plain);
  const tel = /href\s*=\s*["']tel:/i.test(html);
  const brandContent = plain.slice(0, 35000);
  return { title, description: metas.description || '', h1s, lang,
    canonical: links.canonical || '', viewport: metas.viewport || '',
    robotsMeta: [metas.robots || '', metas.googlebot || '', metas.yandex || ''].filter(Boolean).join('; '),
    openGraph: !!(metas['og:title'] && metas['og:description'] && metas['og:image']),
    jsonld: schemaBlocks.length, validJsonLd, organizationSchema, sameAsCount, tel, brandContent,
    visibleWords, headingCount: headings.length, questionHeadings: questionHeadings.length,
    firstParagraphWords, firstParagraph, hasFaq, hasContact };
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


// Optional public third-party renderer. It is used ONLY for public root URLs
// when the site's own server does not provide usable HTML to this Netlify function.
// Never interpret the reader's HTTP 200 as the origin website's HTTP 200.
async function readPublicHtmlThroughReader(target, timeoutMs = 15000) {
  const original = validateTarget(target.href);
  const endpoint = 'https://r.jina.ai/' + original.href;
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'GET', signal: controller.signal, redirect: 'error',
      headers: {
        'Accept': 'text/plain',
        'X-Respond-With': 'html',
        'X-Respond-Timing': 'html',
        'X-Cache-Tolerance': '60',
        ...(process.env.JINA_API_KEY ? {'Authorization':'Bearer ' + process.env.JINA_API_KEY} : {})
      }
    });
    if (!response.ok) throw new Error('Внешний ридер недоступен: HTTP ' + response.status);
    const raw = (await response.text()).slice(0, 950000);
    const pos = raw.search(/<html\b/i);
    if (pos < 0) throw new Error('Внешний ридер не вернул пригодный HTML.');
    const html = raw.slice(pos);
    if (!/<head\b/i.test(html) || !/<(?:title|meta|h1)\b/i.test(html)) {
      throw new Error('HTML ридера не содержит проверяемых метаданных.');
    }
    if (/(?:<title[^>]*>\s*(?:access denied|just a moment|403 forbidden|attention required))/i.test(html)) {
      throw new Error('Ридер получил страницу защиты вместо сайта.');
    }
    return {
      text: html, sourceUrl: endpoint,
      note: 'Вторичный источник: Jina Reader, полученный публичный HTML/DOM. Не подтверждает HTTP-статус и доступ поисковых роботов к оригиналу.'
    };
  } catch (error) {
    throw new Error('Резервное чтение HTML: ' + (error?.name === 'AbortError' ? 'тайм-аут ' + Math.ceil(timeoutMs/1000) + ' с' : error.message));
  } finally { clearTimeout(guard); }
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
  const directHtmlOk = !!(homepage && homepage.status >= 200 && homepage.status < 300 &&
    /<html\b/i.test(homepage.text));
  const directMessage = directHtmlOk ? ('HTTP '+homepage.status+' · '+homepage.url) :
    partialResourceInfo(homepage,error(0),'главную страницу');
  let fallbackHtml = null, fallbackError = '';
  if (!directHtmlOk) {
    try { fallbackHtml = await readPublicHtmlThroughReader(start, 14000); }
    catch (err) { fallbackError = String(err?.message || 'Резервный источник недоступен').slice(0,220); }
  }
  const htmlOk = directHtmlOk || !!fallbackHtml;
  const extractionMode = directHtmlOk ? 'origin' : fallbackHtml ? 'reader' : 'unavailable';
  const htmlBody = directHtmlOk ? homepage.text : fallbackHtml?.text || '';
  const homepageMessage = directHtmlOk ? directMessage :
    fallbackHtml ? 'Прямой доступ: '+directMessage+'. HTML получен через независимый публичный ридер; исходный HTTP-статус не подтверждён.' :
      directMessage+'. '+fallbackError;
  const elapsedMs = Date.now() - startMs;
  const tags = extract(htmlBody);
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
  const metaNoindex = htmlOk ? /\bnoindex\b/i.test(tags.robotsMeta) : false;
  const noindex = htmlOk ? (metaNoindex ||
    (directHtmlOk && /\bnoindex\b/i.test(homepage.headers.get('x-robots-tag') || ''))) : null;
  const indexKnown = directHtmlOk || (htmlOk && metaNoindex);
  const brandFound = brand && htmlOk ? tags.brandContent.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) ||
    tags.title.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) : null;
  const checks = [
    check('response','Прямой доступ главной страницы', directHtmlOk ? true : (homepage && homepage.status === 404 ? false : null), homepageMessage, 'Проверить доступность главной страницы с разрешённого клиента; коды 401/403 и тайм-ауты не являются оценкой SEO.', 'high'),
    check('index','Noindex в HTML и HTTP-заголовках', indexKnown ? !noindex : null, noindex ? 'Найдено указание noindex.' : 'Явных директив noindex в HTML и HTTP-заголовках нет.',
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
    check('structured','Schema.org: Organization / LocalBusiness', htmlOk ? tags.organizationSchema : null,
      tags.organizationSchema ? 'Найдена разметка организации; ссылок sameAs: ' + tags.sameAsCount + '. Проверены типы JSON-LD, но не внешняя достоверность.' :
        'Из ' + tags.jsonld + ' блоков JSON-LD не подтверждён тип Organization, LocalBusiness или Store.',
      'Добавить корректную JSON-LD разметку компании: @type, name, url, контакты, при наличии — sameAs.', 'high'),
    check('og','Open Graph: заголовок, описание, изображение', htmlOk ? tags.openGraph : null,
      tags.openGraph ? 'Найдены og:title, og:description и og:image.' : 'Не обнаружен полный набор og:title, og:description, og:image.',
      'Заполнить Open Graph для представления компании в ссылках и превью; это не гарантия цитирования ИИ.', 'low'),
    check('question-headings','Подзаголовки, похожие на вопросы', htmlOk ? tags.questionHeadings > 0 : null,
      'Подзаголовков h2–h4: ' + tags.headingCount + '; с вопросной формулировкой: ' + tags.questionHeadings + '. Эвристика, не фактор ранжирования.',
      'По возможности добавить точные вопросы клиентов в подзаголовки, не ухудшая читаемость.', 'low'),
    check('first-paragraph','Информативный первый абзац', htmlOk ? tags.firstParagraphWords >= 35 : null,
      'В первом абзаце основного контента: ' + tags.firstParagraphWords + ' слов. Проверяется статический HTML, не текст после JavaScript.',
      'Начать основную страницу с понятного абзаца о компании, услугах и пользе для покупателя (ориентир 40–80 слов).', 'medium'),
    check('visible-text','Достаточно доступного текста', htmlOk ? tags.visibleWords >= 90 : null,
      'В основном статическом HTML обнаружено приблизительно ' + tags.visibleWords + ' слов, без скриптов и декоративных блоков.',
      'Добавить индексируемые описания продукции, услуг, условий работы и полезные ответы на вопросы.', 'medium'),
    check('faq','Раздел вопросов и ответов', htmlOk ? tags.hasFaq : null,
      tags.hasFaq ? 'Найдены признаки FAQ или структурированных вопросов и ответов.' : 'FAQ в основном HTML по текстовым признакам не обнаружен.',
      'Если это уместно, опубликовать ответы на реальные вопросы покупателей. FAQ не обязателен для каждого сайта.', 'low'),
    check('contact','Контактная информация в HTML', htmlOk ? tags.hasContact : null,
      tags.hasContact ? 'Найдены признаки телефона или e-mail в текстовом содержимом / ссылках HTML.' : 'Телефон или e-mail в полученном HTML не обнаружены.',
      'Разместить реальные контакты компании в доступном текстовом виде; отсутствие в HTML может быть связано с JavaScript.', 'medium'),
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
  const groupDefs = [
    { id:'crawl', title:'Доступность для поисковых и ИИ-роботов', maxPoints:32,
      ids:['response','index','robots','sitemap','viewport','airobots','bot-perplexitybot','bot-claude-searchbot','bot-googlebot','bot-bingbot'] },
    { id:'quote', title:'Готовность страницы к цитированию', maxPoints:43,
      ids:['title','description','h1','canonical','lang','question-headings','first-paragraph','visible-text','faq'] },
    { id:'identity', title:'Информация о компании', maxPoints:25,
      ids:['structured','og','contact'] }
  ];
  const geoGroups = groupDefs.map(g => {
    const members = g.ids.map(id => checks.find(x => x.id === id));
    const knownMembers = members.filter(x => x && x.state !== 'unknown');
    const successes = knownMembers.filter(x => x.state === 'ok').length;
    return { id:g.id, title:g.title, maxPoints:g.maxPoints, total:members.length,
      checked:knownMembers.length, passed:successes,
      points:knownMembers.length ? Math.round(g.maxPoints * successes / knownMembers.length) : null,
      checkIds:g.ids };
  });
  const geoScore = directHtmlOk && geoGroups.every(g => g.checked > 0)
    ? geoGroups.reduce((n, g) => n + g.points, 0) : null;
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
    source: 'Независимые запросы к служебным файлам и HTML (прямой, при недоступности — внешний публичный ридер); каждый источник отмечен отдельно',
    domain: start.hostname, url: homepage?.url || start.href, brand: brand || '', httpStatus: homepage?.status ?? null,
    partial: !directHtmlOk, homepageMessage, extractionMode,
    evidence: { htmlSource: fallbackHtml?.sourceUrl || (directHtmlOk ? homepage?.url : null),
      htmlMethod: extractionMode === 'origin' ? 'Прямой HTML с сайта' :
        extractionMode === 'reader' ? 'Публичный HTML/DOM через Jina Reader (вторичный источник)' : 'HTML не получен',
      directHttpStatus: homepage?.status ?? null,
      directMessage, readerError: fallbackError,
      confidence: extractionMode === 'origin' ? 'direct' : extractionMode === 'reader' ? 'secondary' : 'unknown' },
    resourceChecks: targets.map((t,i)=>({name:t.label,url:t.url.href,httpStatus:item(i)?.status ?? null,message:partialResourceInfo(item(i),error(i),t.label)})),
    elapsedMs,
    score: directHtmlOk ? Math.round((passed / Math.max(known.length, 1)) * 100) : null,
    geoScore, geoGroups, checksTotal: checks.length,
    geoScoreNote: 'Это оценка технической пригодности по подтверждённым критериям, а не реальная частота упоминаний в нейросетях. Группы имеют веса 32/43/25; непроверенные критерии исключены из знаменателя и показаны отдельно.',
    checked: known.length, passed, issuesCount: issues.length,
    unknown: checks.filter((x) => x.state === 'unknown').length,
    checks, recommendations, files, botAccess,
    extras: { brandFound, h1Count: tags.h1s.length, title: tags.title, description: tags.description,
      phoneLink: tags.tel, jsonldCount: tags.jsonld, organizationSchema: tags.organizationSchema,
      visibleWords: tags.visibleWords, firstParagraphWords: tags.firstParagraphWords },
    caveat: 'Если прямой HTML недоступен, общий балл не рассчитывается. HTML вторичного источника используется для отдельных метаданных, но не подтверждает доступность для поисковых роботов. Аудит не измеряет позиции и упоминания в ИИ.'
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
