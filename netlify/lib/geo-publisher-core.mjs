import { createHash } from 'node:crypto';

export const WORK_STATUSES = [
  'Новая рекомендация', 'На проверке', 'Подходит для размещения', 'Не подходит',
  'Связались с площадкой', 'Ожидаем ответа', 'Получен отказ',
  'Согласовано размещение', 'Материал готовится', 'Материал отправлен', 'Опубликовано'
];

const small = (value, max = 250) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const norm = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value) => new Set(norm(value).split(/\s+/).filter((w) => w.length > 3));
const stop = new Set(['чтобы','какой','какая','какие','когда','если','нужно','сегодня','можно','купить','найти','лучший','лучшие','стоимость','город','цена','услуги','отзывы','сайт','почему','здесь','this','that','what','where','with','from','best','near','find','как','для','или']);
const useful = (s) => [...words(s)].filter((w) => !stop.has(w));
export const short = small;
export const digest = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 24);
export const isoNow = () => new Date().toISOString();

export function publicUrl(input) {
  const s = small(input, 2000);
  if (!s || /\s/.test(s)) throw Error('Укажите публичный HTTPS-адрес без пробелов.');
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }
  catch { throw Error('Недопустимый URL сайта.'); }
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      h.length > 253 || !h.includes('.') || !/^[a-z0-9.-]+$/.test(h) ||
      /(^|\.)(localhost|local|internal|invalid|test|example|onion)$/.test(h) ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes('..')) {
    throw Error('Разрешены только внешние HTTPS-домены.');
  }
  u.hash = '';
  return u.href;
}

export function domainOf(value) {
  try { return new URL(publicUrl(value)).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

export function inputConfig(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Неверные параметры.');
  const url = publicUrl(data.url);
  const search = ['google', 'yandex', 'both'].includes(data.search) ? data.search : 'both';
  const region = small(data.region, 100);
  if (region.length < 2) throw Error('Укажите регион поиска.');
  const gl = small(data.gl || 'ru', 2).toLowerCase();
  if (!/^[a-z]{2}$/.test(gl)) throw Error('Укажите двухбуквенный код страны Google.');
  const lr = small(String(data.lr || ''), 8);
  if (search !== 'google' && !/^\d{1,7}$/.test(lr)) {
    throw Error('Для Яндекса укажите код региона lr (например, 2 для Санкт-Петербурга, 213 для Москвы).');
  }
  const queries = [...new Set(String(data.queries || '').split(/[\r\n;]+/).map((v) => small(v, 180)).filter(Boolean))];
  if (!queries.length || queries.length > 10 || queries.some((v) => v.length < 3)) {
    throw Error('Введите от 1 до 10 запросов, каждый с новой строки.');
  }
  const max = Number(data.max || 30);
  if (!Number.isInteger(max) || max < 5 || max > 60) throw Error('Количество площадок: от 5 до 60.');
  const budget = data.budget === '' || data.budget == null ? null : Number(data.budget);
  if (budget != null && (!Number.isFinite(budget) || budget < 0 || budget > 100000000)) throw Error('Недопустимый бюджет.');
  const exclusions = [...new Set(String(data.exclusions || '').split(/[\s,;]+/).map(domainOf).filter(Boolean))].slice(0, 150);
  const competitors = [...new Set(String(data.competitors || '').split(/[\s,;]+/).map(domainOf).filter(Boolean))].slice(0, 30);
  return {
    url, domain: domainOf(url), brand: small(data.brand, 120),
    queries, region, search, gl, lr, max, budget,
    competitors, exclusions, audience: small(data.audience, 280),
    createdAt: isoNow()
  };
}

export function parseOrganic(json, engine, query) {
  if (json?.error) throw Error('Поисковый API: ' + small(json.error, 250));
  const list = Array.isArray(json?.organic_results) ? json.organic_results : [];
  return list.slice(0, 20).flatMap((r, idx) => {
    const url = typeof r?.link === 'string' ? r.link : '';
    const domain = domainOf(url);
    if (!domain) return [];
    return [{
      domain, url: publicUrl(url), engine, query,
      position: Number.isInteger(r.position) && r.position > 0 ? r.position : idx + 1,
      title: small(r.title, 250), snippet: small(r.snippet, 600)
    }];
  });
}

export function classify(item) {
  const s = norm([item.domain, item.title, item.snippet].join(' '));
  if (/форум|forum|сообщество|community/.test(s)) return 'Форум / сообщество';
  if (/вопрос|ответ|questions|answers|faq/.test(s)) return 'Вопросы и ответы';
  if (/каталог|справочник|directory|listing/.test(s)) return 'Каталог / справочник';
  if (/обзор|сравнени|review|comparison|рейтинг/.test(s)) return 'Обзоры / сравнения';
  if (/новост|издани|редакци|журнал|news|media/.test(s)) return 'СМИ / издание';
  if (/блог|blog/.test(s)) return 'Блог / экспертный сайт';
  return 'Тематический ресурс';
}

export function collectPlatforms(results, input) {
  const groups = new Map();
  const excluded = new Set([input.domain, ...input.exclusions, ...input.competitors]);
  for (const hit of results) {
    if (excluded.has(hit.domain)) continue;
    if (!groups.has(hit.domain)) groups.set(hit.domain, {
      id: digest(hit.domain), domain: hit.domain, name: hit.domain, type: classify(hit),
      matches: [], title: hit.title, snippet: hit.snippet,
      publication: { status: 'unknown', source: null, verifiedAt: null },
      contacts: [], price: null, quality: null, geographyEvidence: null,
      workStatus: WORK_STATUSES[0], notes: '', publishedUrl: null,
      publicationDate: null
    });
    const g = groups.get(hit.domain);
    if (!g.matches.some((v) => v.url === hit.url && v.query === hit.query && v.engine === hit.engine)) g.matches.push(hit);
    if (hit.title.length > (g.title || '').length) g.title = hit.title;
    if (hit.snippet.length > (g.snippet || '').length) g.snippet = hit.snippet;
  }
  const arr = [...groups.values()];
  for (const item of arr) item.type = classify(item);
  return arr.sort((a, b) => new Set(b.matches.map((v) => v.query + '|' + v.engine)).size -
    new Set(a.matches.map((v) => v.query + '|' + v.engine)).size ||
    Math.min(...a.matches.map((v) => v.position)) - Math.min(...b.matches.map((v) => v.position)));
}

export function evaluate(item, input, searchCount) {
  const total = Math.max(1, searchCount);
  const qWords = new Set(input.queries.flatMap(useful));
  const siteWords = new Set(useful([item.title, item.snippet, item.domain].join(' ')));
  const intersection = [...qWords].filter((w) => siteWords.has(w)).length;
  const rel = qWords.size ? Math.round(100 * intersection / qWords.size) : 0;
  const appearances = new Set((item.matches || []).map((m) => m.query + '|' + m.engine)).size;
  const avgRank = (item.matches || []).length ?
    item.matches.reduce((a, v) => a + Math.min(20, Number(v.position) || 20), 0) / item.matches.length : 20;
  const visibility = Math.round(100 * Math.min(1, appearances / total) * (1.05 - avgRank / 40));
  const pub = item.publication?.status === 'confirmed' ? 100 :
    item.publication?.status === 'unavailable' ? 0 : null;
  const quality = Number.isInteger(item.quality) ? Math.max(0, Math.min(100, item.quality)) : null;
  const geo = Number.isInteger(item.geographyEvidence) ? item.geographyEvidence : null;
  const access = item.publication?.status === 'confirmed' ?
    (item.price == null ? 60 : input.budget == null || item.price <= input.budget ? 100 : 20) : null;
  const criteria = {
    relevance: {weight:30,value:rel},
    visibility: {weight:20,value:Math.max(0,Math.min(100,visibility))},
    publication: {weight:20,value:pub},
    quality: {weight:15,value:quality},
    geography: {weight:10,value:geo},
    access: {weight:5,value:access}
  };
  let lower = 0, coverage = 0;
  for (const val of Object.values(criteria)) {
    if (val.value !== null) { lower += val.weight * val.value / 100; coverage += val.weight; }
  }
  lower = Math.round(lower);
  const upper = Math.min(100, lower + 100 - coverage);
  // Unknown is *not* silently converted into a guessed point score.
  const rating = coverage >= 70 ? lower : null;
  const priority = rating == null ? 'Недостаточно данных' :
    rating >= 80 ? 'Высокий' : rating >= 60 ? 'Средний' : rating >= 40 ? 'Низкий' : 'Не рекомендовать';
  return { ...item, criteria, score: rating, scoreMin: lower, scoreMax: upper, coverage,
    priority, suggestedTopic: item.suggestedTopic || suggestTopic(item, input) };
}

export function suggestTopic(item, input) {
  const terms = input.queries[0] || '';
  return 'Практический обзор: ' + terms.charAt(0).toUpperCase() + terms.slice(1).replace(/[?.!]+$/, '');
}

export function makeBrief(item, input) {
  const topic = item.suggestedTopic || suggestTopic(item, input);
  const rules = item.publication?.status === 'confirmed' ?
    (item.publication?.conditions || 'Уточнить ограничения и редакционные требования.') :
    'Условия размещения не подтверждены. До подготовки материала уточнить у редакции.';
  const brand = input.brand || 'бренд клиента';
  const list = [
    'ТЕХНИЧЕСКОЕ ЗАДАНИЕ НА GEO-ПУБЛИКАЦИЮ',
    '', 'Площадка: ' + item.domain,
    'Тема: ' + topic,
    'Рабочий заголовок: ' + topic,
    'Кластер: ' + input.queries.join('; '),
    'Аудитория: ' + (input.audience || 'Уточнить целевую аудиторию с клиентом'),
    'Формат: ' + (item.type || 'экспертная статья / обзор'),
    '', 'СТРУКТУРА СТАТЬИ',
    '1. Вводная: проблема и контекст читателя.',
    '2. Основные критерии выбора, объективные данные и ограничения.',
    '3. Сравнение нескольких подходов или вариантов решения.',
    '4. Практические рекомендации и проверяемые источники.',
    '5. Ответы на частые вопросы и итог.',
    '', 'УПОМИНАНИЕ БРЕНДА',
    'Упоминать ' + brand + ' только в подходящем контексте, без выдуманных преимуществ и рекламных обещаний.',
    'Ссылки и рекламная маркировка — только по условиям редакции и применимым правилам.',
    '', 'ТРЕБОВАНИЯ ПЛОЩАДКИ',
    rules,
    'Источник условий: ' + (item.publication?.source || 'Не найден'),
    'Последняя проверка: ' + (item.publication?.verifiedAt || 'Не проведена'),
    '', 'КОНТРОЛЬ КАЧЕСТВА',
    'Все сведения, цифры и сравнения подтвердить источниками. Перед размещением требуется согласование специалиста.',
    'Объём: согласовать с редакцией; без подтверждённых требований не назначать случайное число знаков.'
  ];
  return list.join('\n');
}

const headers = ['Площадка','Домен','URL из выдачи','Кластер','Запросы и позиции','Тип',
  'Релевантность','Возможность публикации','Условия','Стоимость','Контакт','Источник','Дата источника',
  'Рейтинг','Минимум','Максимум','Покрытие оценки','Приоритет','Тема материала',
  'ТЗ','Рабочий статус','Комментарий','Дата проверки','Ссылка на публикацию'];
export function exportRows(run) {
  return [
    headers,
    ...(run.platforms || []).map((p) => [
      p.name || p.domain, p.domain, p.matches?.[0]?.url || '', (run.input?.queries || []).join('; '),
      (p.matches || []).map((v) => v.engine + ': ' + v.query + ' #' + v.position).join(' | '),
      p.type || '', p.criteria?.relevance?.value ?? '', p.publication?.status || 'unknown',
      p.publication?.conditions || '', p.price ?? '',
      (p.contacts || []).join(', '), p.publication?.source || '',
      p.publication?.verifiedAt || '', p.score ?? '', p.scoreMin ?? '', p.scoreMax ?? '',
      p.coverage ?? '', p.priority || '', p.suggestedTopic || '', p.brief || '',
      p.workStatus || '', p.notes || '', p.checkedAt || '', p.publishedUrl || ''
    ])
  ];
}
export function csv(rows) {
  return '\ufeff' + rows.map((row) => row.map((v) =>
    '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&") + '"').join(',')).join('\r\n');
}

// Minimal standards-compliant XLSX writer: ZIP-store + SpreadsheetML, without runtime dependencies.
const XML = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function column(index) { let s=''; for(let n=index+1;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s;return s; }
function sheetXml(rows) {
  const body=rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>{
    const value = String(v == null ? '' : v).replace(/^[=+\-@\t\r]/, "'$&");
    const typ = typeof v === 'number' && Number.isFinite(v) ? '' : ' t="inlineStr"';
    const data = typ ? '<is><t xml:space="preserve">'+XML(value)+'</t></is>' : '<v>'+v+'</v>';
    return '<c r="'+column(j)+(i+1)+'"'+typ+(i===0?' s="1"':'')+'>'+data+'</c>';
  }).join('')+'</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="'+rows[0].length+'" width="22" customWidth="1"/></cols>'+
    '<sheetData>'+body+'</sheetData><autoFilter ref="A1:'+column(rows[0].length-1)+rows.length+'"/></worksheet>';
}
const CRC_TABLE = Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let c=0xffffffff;for(const n of b)c=CRC_TABLE[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(files){
  const locals=[],central=[];let offset=0;
  for(const [name,data] of Object.entries(files)){
    const nb=Buffer.from(name),content=Buffer.from(data),crc=crc32(content);
    const l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);
    l.writeUInt32LE(content.length,18);l.writeUInt32LE(content.length,22);l.writeUInt16LE(nb.length,26);
    c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(content.length,20);c.writeUInt32LE(content.length,24);
    c.writeUInt16LE(nb.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,nb,content);central.push(c,nb);offset+=l.length+nb.length+content.length;
  }
  const cd=Buffer.concat(central),tail=Buffer.alloc(22);tail.writeUInt32LE(0x06054b50,0);
  tail.writeUInt16LE(Object.keys(files).length,8);tail.writeUInt16LE(Object.keys(files).length,10);
  tail.writeUInt32LE(cd.length,12);tail.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,tail]);
}
export function xlsx(rows){
  const files={
    '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="GEO площадки" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244E97"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf fontId="1" fillId="1" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml':sheetXml(rows)
  };
  return zip(files);
}