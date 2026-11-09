// Evidence-first aggregation of sites visible in responses or retrieved source lists.
// A cited publisher or directory is NOT automatically a competing business.
(function (root) {
  'use strict';
  const IGNORE = new Set([
    'google.com','google.ru','google.kz','yandex.ru','yandex.com','yandex.kz','ya.ru',
    '2gis.ru','2gis.kz','maps.google.com','prodoctorov.ru','napopravku.ru','docdoc.ru',
    'zoon.ru','otzovik.com','irecommend.ru','flamp.ru','yell.ru','tripadvisor.com',
    'wikipedia.org','wikidata.org','youtube.com','rutube.ru','vk.com','t.me',
    'telegram.me','facebook.com','instagram.com','x.com','twitter.com',
    'openai.com','chatgpt.com','perplexity.ai','giga.chat','gemini.google.com',
    'deepseek.com','sber.ru','dzen.ru','yandex.net','api.cloud.yandex.net'
  ]);
  const suffixOfIgnored = host => [...IGNORE].some(ignored =>
    host === ignored || host.endsWith('.' + ignored));
  function hostOf(raw) {
    try {
      if (typeof raw !== 'string' || raw.length > 1800) return null;
      const value = raw.trim();
      const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return null;
      const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
      if (!host.includes('.') || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
      if (host.endsWith('.local') || host.endsWith('.internal')) return null;
      return host;
    } catch { return null; }
  }
  function domainsInAnswer(answer) {
    if (typeof answer !== 'string') return [];
    const sites = new Map();
    const urls = answer.match(/https?:\/\/[^\s<>"'\x60{}\[\]]+/gi) || [];
    for (const raw of urls) {
      const url = raw.replace(/[.,;:!?)]*$/g, '');
      const domain = hostOf(url);
      if (domain && !sites.has(domain)) sites.set(domain,{domain,url,evidence:'answer'});
    }
    const regexp = /(?:[\p{L}\p{N}-]+\.)+(?:[a-z]{2,24}|рф)(?![\p{L}\p{N}-])/giu;
    for (const match of answer.matchAll(regexp)) {
      if (match.index > 0 && answer[match.index - 1] === '@') continue;
      const domain = hostOf(match[0]);
      if (domain && !sites.has(domain)) sites.set(domain,{domain,url:'https://' + domain,evidence:'answer'});
    }
    return [...sites.values()].slice(0,35);
  }
  function sitesInResult(result, ownDomain) {
    if (!result || result.error || !result.answer) return [];
    const own = hostOf(ownDomain);
    const found = new Map();
    for (const site of domainsInAnswer(result.answer)) found.set(site.domain,site);
    for (const ref of Array.isArray(result.sources) ? result.sources.slice(0,24) : []) {
      const raw = typeof ref === 'string' ? ref : ref?.url;
      const domain = hostOf(raw);
      if (domain && !found.has(domain)) found.set(domain,{domain,url:raw,evidence:'source'});
    }
    return [...found.values()].filter(item => {
      if (own && (item.domain === own || item.domain.endsWith('.' + own))) return false;
      if (suffixOfIgnored(item.domain)) return false;
      if (/\.(?:gov|edu)(?:\.[a-z]{2,3})?$/.test(item.domain)) return false;
      return true;
    }).slice(0,30);
  }
  function aggregate(results,ownDomain,onlyWithoutBrand=true) {
    const stats=new Map();
    const answered=Array.isArray(results)?results:[];
    for (const result of answered) {
      if (!result || result.error || !result.answer) continue;
      if (onlyWithoutBrand && result.brandMention) continue;
      for(const site of sitesInResult(result,ownDomain)){
        let row=stats.get(site.domain);
        if(!row){
          row={domain:site.domain,url:site.url,count:0,answerCount:0,sourceCount:0,
            systems:[],_seen:new Set()};
          stats.set(site.domain,row);
        }
        const job=String(result.provider||'')+'|'+String(result.prompt||'');
        if(row._seen.has(job))continue;
        row._seen.add(job);
        row.count++;
        if(site.evidence==='answer')row.answerCount++;else row.sourceCount++;
        if(result.provider && !row.systems.includes(result.provider))row.systems.push(result.provider);
        if(site.evidence==='answer')row.url=site.url;
      }
    }
    return [...stats.values()].map(row=>{
      const {_seen,...publicRow}=row;
      return publicRow;
    }).sort((a,b)=>b.answerCount-a.answerCount ||
      b.systems.length-a.systems.length || b.count-a.count ||
      a.domain.localeCompare(b.domain)).slice(0,100);
  }
  root.MIRVIXCompetingSites=Object.freeze({hostOf,domainsInAnswer,sitesInResult,aggregate});
})(globalThis);
