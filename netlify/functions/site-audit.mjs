import dns from 'node:dns/promises';
import net from 'node:net';

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
}

async function getText(start, limit = 950000) {
  let current = start;
  for (let hop = 0; hop < 4; hop++) {
    await checkHost(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'MIRVIX-Audit/1.0 (+https://mirvixai.com/audit/)',
          accept: 'text/html,application/xml,text/plain;q=0.9,*/*;q=0.5'
        }
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const next = new URL(response.headers.get('location'), current);
        await response.body?.cancel();
        if (next.protocol !== 'https:' || next.origin !== start.origin) {
          throw new Error('Сайт перенаправляет на другой домен. Проверьте итоговый URL отдельно.');
        }
        current = next;
        continue;
      }
      const type = response.headers.get('content-type') || '';
      if (type && !/(text|xml|html|json|octet-stream)/i.test(type)) {
        return { status: response.status, text: '', headers: response.headers, url: current.href };
      }
      const reader = response.body?.getReader();
      if (!reader) return { status: response.status, text: '', headers: response.headers, url: current.href };
      const chunks = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.length;
        if (total > limit) {
          await reader.cancel();
          break;
        }
        chunks.push(next.value);
      }
      const bytes = Buffer.concat(chunks);
      return { status: response.status, text: bytes.toString('utf8'), headers: response.headers, url: current.href };
    } finally {
      clearTimeout(timer);
    }
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

function botBlocked(content, name) {
  if (!content) return null;
  const groups = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const value = line.split('#')[0].trim();
    if (!value) continue;
    const pos = value.indexOf(':');
    if (pos < 0) continue;
    const key = value.slice(0, pos).trim().toLowerCase();
    const val = value.slice(pos + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ key, val });
    }
  }
  const matching = groups.filter((g) => g.agents.includes(name.toLowerCase()));
  const fallback = matching.length ? matching : groups.filter((g) => g.agents.includes('*'));
  let chosen = null;
  for (const group of fallback) {
    for (const rule of group.rules) {
      if (!rule.val || !'/'.startsWith(rule.val.replace(/\*.*$/, ''))) continue;
      if (!chosen || rule.val.length > chosen.val.length ||
          (rule.val.length === chosen.val.length && rule.key === 'allow')) {
        chosen = rule;
      }
    }
  }
  return chosen ? chosen.key === 'disallow' : false;
}

function check(id, title, ok, detail, tip, importance = 'medium') {
  return { id, title, state: ok === null ? 'unknown' : ok ? 'ok' : 'issue',
    detail: String(detail || '').slice(0, 240),
    tip: ok ? '' : tip, importance };
}

async function audit(raw, brand) {
  const start = validateTarget(raw);
  let homepage;
  const startMs = Date.now();
  try {
    homepage = await getText(start);
  } catch (e) {
    throw new Error('Не удалось получить страницу: ' + (e.message || 'ошибка соединения'));
  }
  const elapsedMs = Date.now() - startMs;
  if (homepage.status < 200 || homepage.status >= 300 || !/<html\b/i.test(homepage.text)) {
    throw new Error('Главная страница не вернула доступный HTML (HTTP ' + homepage.status + ').');
  }
  const [robots, sitemap] = await Promise.all([
    getText(new URL('/robots.txt', start), 140000).catch(() => null),
    getText(new URL('/sitemap.xml', start), 200000).catch(() => null)
  ]);
  const tags = extract(homepage.text);
  const robotsAvailable = robots && robots.status === 200 && /user-agent\s*:/i.test(robots.text);
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
  const block = robotsAvailable ? botBlocked(robots.text, 'OAI-SearchBot') : null;
  const noindex = /\bnoindex\b/i.test(tags.robotsMeta + '; ' + (homepage.headers.get('x-robots-tag') || ''));
  const brandFound = brand ? tags.brandContent.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) ||
    tags.title.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru')) : null;
  const checks = [
    check('response','Сайт доступен по HTTPS', true, 'HTTP ' + homepage.status + ' · ' + homepage.url, '', 'high'),
    check('index','Индексация не запрещена', !noindex, noindex ? 'Найдено указание noindex.' : 'Явных директив noindex в HTML и HTTP-заголовках нет.',
      'Проверить meta robots и X-Robots-Tag: поисковики могут игнорировать страницу.', 'high'),
    check('title','Заголовок страницы (title)', !!tags.title, tags.title || 'Тег title не обнаружен.',
      'Добавить уникальный title с услугой, городом и названием компании.', 'high'),
    check('description','Описание (meta description)', !!tags.description, tags.description || 'Метаописание не обнаружено.',
      'Подготовить ясное описание услуг и преимуществ компании.', 'medium'),
    check('h1','Основной заголовок H1', tags.h1s.length > 0, tags.h1s.length ? tags.h1s.join(' | ') : 'H1 не найден.',
      'Добавить видимый заголовок H1 о ключевой услуге.', 'medium'),
    check('canonical','Канонический адрес', !!tags.canonical, tags.canonical || 'Canonical не обнаружен.',
      'Добавить rel=canonical на основную версию страницы.', 'medium'),
    check('lang','Язык страницы', !!tags.lang, tags.lang ? 'lang="' + tags.lang + '"' : 'Атрибут lang не найден.',
      'Задать атрибут lang у HTML.', 'low'),
    check('viewport','Мобильная адаптация (viewport)', !!tags.viewport, tags.viewport || 'Viewport не найден.',
      'Добавить meta viewport и проверить реальное отображение на телефоне.', 'medium'),
    check('robots','Файл robots.txt', robots === null ? null : !!robotsAvailable,
      robots === null ? 'Не удалось получить robots.txt.' : robotsAvailable ? 'Доступен: ' + start.origin + '/robots.txt' : 'Файл robots.txt не найден или формат не распознан.',
      'Создать или проверить robots.txt. Это рекомендация, не обязательное условие индексации.', 'medium'),
    check('sitemap','XML-карта сайта', finalMap === null ? null : sitemapOk,
      finalMap === null ? 'Не удалось проверить sitemap.' : sitemapOk ? 'Карта сайта найдена.' : 'Карта сайта по стандартному адресу или robots.txt не обнаружена.',
      'Создать sitemap.xml и указать его в robots.txt и кабинетах вебмастеров.', 'medium'),
    check('structured','Структурированные данные JSON-LD', tags.jsonld > 0, tags.jsonld ? 'Найдено JSON-LD блоков: ' + tags.jsonld + '. Корректность данных не проверялась.' : 'JSON-LD на главной не найден.',
      'Добавить достоверную разметку Organization, LocalBusiness или подходящий тип Schema.org.', 'medium'),
    check('og','Превью для социальных сетей', tags.openGraph, tags.openGraph ? 'Найдены Open Graph title и description.' : 'Не обнаружена полная пара og:title / og:description.',
      'Настроить Open Graph для корректного отображения ссылок.', 'low'),
    check('airobots','Доступность OAI-SearchBot', block === null ? null : !block,
      block === null ? 'Нельзя надёжно определить по robots.txt.' :
        block ? 'В robots.txt есть правило, запрещающее корневую страницу OAI-SearchBot.' :
          'Явной блокировки корневой страницы OAI-SearchBot не выявлено.',
      'Проверить блокировку OAI-SearchBot. Правила других ботов и страниц требуют отдельной проверки.', 'high')
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
    source: 'Прямая проверка публичного HTML и служебных файлов; без доступа к кабинетам вебмастеров',
    domain: start.hostname, url: homepage.url, brand: brand || '', httpStatus: homepage.status,
    elapsedMs,
    score: Math.round((passed / Math.max(known.length, 1)) * 100),
    checked: known.length, passed, issuesCount: issues.length,
    unknown: checks.filter((x) => x.state === 'unknown').length,
    checks, recommendations,
    extras: { brandFound, h1Count: tags.h1s.length, title: tags.title, description: tags.description,
      phoneLink: tags.tel, jsonldCount: tags.jsonld },
    caveat: 'Экспресс-аудит не показывает позиции в Google/Яндексе и не измеряет упоминания в ChatGPT, Алисе и других ИИ. Это отдельные проверки.'
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

export const _test = { validateTarget, publicIp, extract, botBlocked, audit };
