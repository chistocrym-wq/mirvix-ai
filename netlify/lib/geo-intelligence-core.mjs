// MIRVIX Intelligence: evidence-first competitor/SEO/AI analysis.
// Never equate a cited document with a competing business and never invent traffic.
const CAP=100;
const norm=x=>String(x??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
const hostname=x=>{try{return new URL(/^https?:\/\//i.test(x)?x:'https://'+x).hostname.toLowerCase().replace(/^www\./,'')}catch{return null}};
const same=(a,b)=>!!(a&&b&&(a===b||a.endsWith('.'+b)));
export const directoryDomains=new Set([
  '2gis.ru','prodoctorov.ru','napopravku.ru','yell.ru','zoon.ru','docdoc.ru','medbooking.com','doctu.ru','yandex.ru',
  'maps.google.com','google.com','otzovik.com','otzovik.ru','irecommend.ru','flamp.ru','wikipedia.org','t.me',
  'vk.com','youtube.com','rutube.ru','dzen.ru'
]);
export function siteKind(hit) {
  const domain=hostname(hit.domain||hit.url);
  if(domain&&[...directoryDomains].some(d=>same(domain,d)))return 'Каталог или платформа';
  const s=norm([hit.title,hit.snippet,domain].filter(Boolean).join(' '));
  if(/каталог|справочник|агрегатор|отзывы о|directory|listing/.test(s))return 'Каталог или платформа';
  if(/портал|журнал|блог|статьи|сми|новости|издание|news|blog|forum|форум|сравнение/.test(s))return 'СМИ или информационный ресурс';
  return 'Возможная компания-конкурент';
}
const unique=items=>[...new Set(items)];
const rank=hit=>Number.isInteger(hit?.position)&&hit.position>0&&hit.position<=100?hit.position:null;
const source=(hit)=>({engine:hit.engine,query:hit.query,position:rank(hit),url:hit.url,title:hit.title||''});
export function seoAnalysis(input,rawHits) {
  const hits=Array.isArray(rawHits)?rawHits.filter(h=>h?.engine&&h?.query&&hostname(h.url)):[]; 
  const own=hostname(input?.url||input?.domain);
  const confirmed=new Set((input?.competitors||[]).map(hostname).filter(Boolean));
  const keys=(input?.queries||[]).flatMap(q=>{
    const engines=input.search==='both'?['google','yandex']:[input.search||'google'];
    return engines.map(engine=>({query:q,engine}));
  });
  const groups=new Map();
  for(const {engine,query} of keys)groups.set(engine+'\u0000'+query,[]);
  for(const h of hits){const k=h.engine+'\u0000'+h.query;if(groups.has(k))groups.get(k).push(h);}
  const candidateMap=new Map();
  const matrix=keys.map(({query,engine})=>{
    const hs=(groups.get(engine+'\u0000'+query)||[]).sort((a,b)=>(rank(a)??999)-(rank(b)??999));
    const ownHit=hs.find(h=>same(hostname(h.domain||h.url),own));
    const ownPosition=ownHit?rank(ownHit):null;
    const peers=[];
    const seen=new Set();
    for(const h of hs){
      const domain=hostname(h.domain||h.url);
      if(!domain||same(domain,own)||seen.has(domain))continue;
      seen.add(domain);
      const kind=siteKind(h);
      const verified=[...confirmed].some(c=>same(domain,c));
      peers.push({domain,position:rank(h),url:h.url,title:h.title||'',kind,confirmed:verified});
      let entry=candidateMap.get(domain);
      if(!entry){
        entry={domain,name:domain,type:kind,confirmed:verified,positions:[],
          queries:new Set(),engines:new Set(),sources:[]};
        candidateMap.set(domain,entry);
      }
      entry.positions.push(rank(h));
      entry.queries.add(query);entry.engines.add(engine);entry.sources.push(source(h));
    }
    const verifiedPeers=peers.filter(p=>p.confirmed);
    const businessCandidates=peers.filter(p=>p.kind==='Возможная компания-конкурент');
    const bestVerified=verifiedPeers.reduce((best,p)=>Math.min(best,p.position??100),100);
    const bestCandidate=businessCandidates.reduce((best,p)=>Math.min(best,p.position??100),100);
    const competitorRank=bestVerified<100?bestVerified:null;
    const potentialRank=bestCandidate<100?bestCandidate:null;
    let opportunity='Нет подтверждённого отставания';
    if(competitorRank!==null && (ownPosition===null||ownPosition>=competitorRank+5))
      opportunity='Подтверждённый SEO-разрыв';
    else if(competitorRank===null&&potentialRank!==null&&(ownPosition===null||ownPosition>=potentialRank+5))
      opportunity='Гипотеза: конкурентный разрыв';
    return {query,engine,ownPosition,ownUrl:ownHit?.url||null,
      checkedAt:hs.find(h=>h.checkedAt)?.checkedAt||null,source:'SerpApi organic_results',
      tested:hs.length>0,returned:hs.length,topPeers:peers.slice(0,10),
      confirmedCompetitorRank:competitorRank,candidateRank:potentialRank,opportunity,
      remark:!hs.length?'Нет данных поискового API':ownPosition===null?'Не обнаружен среди полученных органических результатов':'Зафиксированная позиция выборки'};
  });
  const candidates=[...candidateMap.values()].map(c=>({
    domain:c.domain,name:c.name,type:c.type,confirmed:c.confirmed,
    appearances:c.sources.length,queries:[...c.queries],engines:[...c.engines],
    bestPosition:Math.min(...c.positions.filter(x=>x!=null),100),
    evidence:c.sources.slice(0,12)
  })).sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||b.queries.length-a.queries.length||a.bestPosition-b.bestPosition);
  return {ownDomain:own,rows:matrix,candidates:candidates.slice(0,CAP),
    measured:matrix.filter(r=>r.tested).length,
    ownTop20:matrix.filter(r=>r.tested&&r.ownPosition!==null).length,
    ownTop10:matrix.filter(r=>r.tested&&r.ownPosition!==null&&r.ownPosition<=10).length,
    confirmedGaps:matrix.filter(r=>r.opportunity==='Подтверждённый SEO-разрыв').length,
    possibleGaps:matrix.filter(r=>r.opportunity==='Гипотеза: конкурентный разрыв').length,
    method:'Органические URL, полученные поисковым API по конкретному региону и запросам. Не является общим рейтингом всего сайта.'};
}
export function aiAnalysis(plan,results,brand,confirmedNames=[]) {
  const prompts=(plan?.prompts||[]).filter(s=>typeof s==='string');
  const providers=(plan?.providers||[]).filter(s=>typeof s==='string');
  const get=(prompt,provider)=>results.find(r=>r?.prompt===prompt&&r?.provider===provider)||null;
  const matrix=prompts.map(prompt=>{
    const items=providers.map(provider=>{
      const raw=get(prompt,provider);
      const isError=!!raw?.error;const ok=raw&&typeof raw.answer==='string'&&raw.answer.trim()&&!isError;
      const mentions=ok?(raw.competitorsMentioned||[]).filter(x=>confirmedNames.some(c=>norm(c)===norm(x))):[];
      return {provider,status:!raw?'Не проверено':isError?'Ошибка':ok?'Получен ответ':'Нет ответа',
        brand:ok?!!raw.brandMention:null,cited:ok?!!raw.sourceMention:null,
        competitors:mentions,mode:raw?.mode||null,
        searchable:raw?.searchEvidence===true,sources:ok?(raw.sources||[]).slice(0,8):[],
        model:raw?.model||null,checkedAt:raw?.checkedAt||null,error:raw?.error||null};
    });
    const validWeb=items.filter(v=>v.status==='Получен ответ'&&v.mode!=='model-only'&&v.searchable===true);
    const rivalWins=validWeb.filter(v=>!v.brand&&v.competitors.length>0);
    return {prompt,items,successfulWebAnswers:validWeb.length,rivalOnly:rivalWins.length,
      brandSeen:validWeb.filter(v=>v.brand).length};
  });
  const web=matrix.flatMap(x=>x.items).filter(x=>x.status==='Получен ответ'&&x.mode!=='model-only'&&x.searchable===true);
  const total=matrix.flatMap(x=>x.items);
  return {matrix,attempted:total.filter(x=>x.status!=='Не проверено').length,
    successfulWebAnswers:web.length,brandMentions:web.filter(x=>x.brand).length,
    ownCitations:web.filter(x=>x.cited).length,
    modelOnlyAnswers:total.filter(x=>x.status==='Получен ответ'&&x.mode==='model-only').length,
    ungroundedAnswers:total.filter(x=>x.status==='Получен ответ'&&x.searchable!==true).length,
    errors:total.filter(x=>x.status==='Ошибка').length,
    mentionRate:web.length?Math.round(100*web.filter(x=>x.brand).length/web.length):null,
    rivalOnlyQuestions:matrix.filter(x=>x.rivalOnly>0).map(x=>({prompt:x.prompt,rivalOnly:x.rivalOnly,systems:x.items.filter(i=>!i.brand&&i.competitors.length).map(i=>i.provider)})),
    note:'В доли входят только ответы с подтверждённым веб-поиском (searchEvidence=true). API-ответы без поиска, неподтверждённый grounding и ошибки исключены. Это не статистика пользователей приложений.'};
}
export function priorityActions(seo,ai,audit,traffic) {
  const actions=[];
  const add=(priority,area,title,detail,evidence)=>actions.push({priority,area,title,detail,evidence});
  if(audit?.recommendations?.length)for(const a of audit.recommendations.slice(0,5))add(
    a.importance==='high'?'Срочно':'Планово','Сайт',a.title,a.text,'Технический аудит '+(audit.checkedAt||''));
  else if(!audit)add('Срочно','Данные','Проверить техническую готовность сайта',
    'Запустите технический аудит сайта и проверьте индексирование, структуру услуг, контакты и доступность ИИ-роботам.','Аудит ещё не выполнен');
  if(seo?.confirmedGaps)add('Срочно','SEO','Закрыть подтверждённые разрывы в поиске',
    'Подготовить отдельные полезные страницы по запросам, где подтверждённые конкуренты выше клиента; проверить релевантность посадочных и локальные карточки.',
    seo.confirmedGaps+' запросов с измеренным отставанием');
  if(seo?.possibleGaps)add('Проверить','Конкуренты','Подтвердить личности компаний в выдаче',
    'Сайты из выдачи ещё могут оказаться СМИ, каталогами или нерелевантными организациями. Уточнить действующих конкурентов.',
    seo.possibleGaps+' потенциальных разрывов');
  if(seo?.measured===0)add('Срочно','SEO','Собрать фактические позиции Яндекс и Google',
    'Подключить поисковый API и проверить брендовые и коммерческие запросы по каждой услуге.',
    'Поисковых результатов нет');
  if(ai?.rivalOnlyQuestions?.length)add('Срочно','GEO','Обработать запросы, на которых рекомендуют конкурентов',
    'Для каждого проигрываемого запроса определить, откуда ИИ берёт сведения, улучшить подтверждённые данные о компании и добиться публикаций на релевантных авторитетных ресурсах.',
    ai.rivalOnlyQuestions.length+' вопросов с конкурентными упоминаниями');
  else if(!ai?.attempted)add('Планово','ИИ','Проверить все доступные ИИ по одной матрице',
    'Выполнить одинаковые естественные небредовые запросы в подключённых моделях, сохранить ответы, ссылки и даты; ошибки не считать отсутствием бренда.',
    'Ещё нет измерений');
  if(!traffic?.rows?.length)add('Планово','Аналитика','Подключить источники трафика и заявок',
    'Получить доступ к Яндекс.Метрике/GA4, поисковым консолям и CRM или загрузить подтверждённую выгрузку. Проверять визиты, звонки, записи и качество лидов, а не только позиции.',
    'Данных о визитах и заявках пока нет');
  return actions;
}
export function trafficSummary(raw) {
  if(!raw||!Array.isArray(raw.rows)||!raw.rows.length)return {source:null,rows:[],visits:null,leads:null,note:'Нет данных: нужен доступ к Метрике/GA4 и источнику заявок.'};
  const rows=raw.rows.filter(r=>r&&r.source&&Number.isFinite(r.visits)&&r.visits>=0&&Number.isFinite(r.leads)&&r.leads>=0).slice(0,60);
  const visits=rows.reduce((s,r)=>s+r.visits,0),leads=rows.reduce((s,r)=>s+r.leads,0);
  return {source:raw.source,period:raw.period,addedAt:raw.addedAt,rows,visits,leads,note:'Значения из предоставленной выгрузки, не подтверждены прямым API и не отражают офлайн обращения без CRM.'};
}
export const _test={hostname,same};