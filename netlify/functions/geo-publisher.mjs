import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { isStaffRequest } from '../lib/cabinet-session.mjs';
import { _test as audit } from './site-audit.mjs';
import {
  WORK_STATUSES, inputConfig, parseOrganic, collectPlatforms,
  evaluate, makeBrief, exportRows, csv, xlsx, digest, short, publicUrl, domainOf, isoNow
} from '../lib/geo-publisher-core.mjs';

const H = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store',
  'x-content-type-options':'nosniff' };
const respond = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{...H,...headers}});
const db = () => getStore({name:'mirvix-geo-publisher',consistency:'strong'});
const runKey = id => 'runs/' + id;
const stageKey = (id,i) => 'stages/' + id + '/' + String(i).padStart(2,'0');
const editKey = (id,domain) => 'edits/' + id + '/' + digest(domain);
const globalKey = domain => 'platforms/' + digest(domain);
function err(e){return String(e?.message||'Ошибка выполнения').slice(0,300);}
function requireId(x){if(!/^[0-9a-f-]{36}$/i.test(String(x||'')))throw Error('Недопустимый идентификатор запуска.');return x;}
const getJSON = (store,key) => store.get(key,{type:'json',consistency:'strong'});
const persist = (store,key,value) => store.setJSON(key,value);

function stageList(input){
  const engines = input.search === 'both' ? ['google','yandex'] : [input.search];
  return input.queries.flatMap(query => engines.map(engine => ({query,engine})));
}

export async function querySerpApi(query,engine,input){
  const token=process.env.MIRVIX_SERPAPI_KEY||process.env.SERPAPI_KEY;
  if(!token) throw Error('Для живого поиска установите MIRVIX_SERPAPI_KEY в переменных Netlify.');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('api_key',token);
  url.searchParams.set('engine',engine);
  if(engine==='google'){
    url.searchParams.set('q',query);
    url.searchParams.set('num','20');
    url.searchParams.set('gl',input.gl);
    url.searchParams.set('hl','ru');
    url.searchParams.set('location',input.region);
  } else {
    // SerpApi Yandex engine requires text instead of Google q.
    url.searchParams.set('text',query);
    url.searchParams.set('groups_on_page','20');
    url.searchParams.set('yandex_domain','yandex.ru');
    url.searchParams.set('lr',input.lr);
    url.searchParams.set('lang','ru');
  }
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),21000);
  try{
    const response=await fetch(url,{signal:ctl.signal,redirect:'error',headers:{accept:'application/json'}});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error('Поисковый API HTTP '+response.status+': '+short(data?.error||'проверьте ключ, оплату и лимиты',170));
    if(!data || data.error)throw Error(short(data?.error||'Некорректный ответ поискового API',220));
    if(!Array.isArray(data.organic_results))throw Error('API не вернул organic_results — проверьте доступность поисковой системы и региона.');
    return parseOrganic(data,engine,query);
  }finally{clearTimeout(timer);}
}

async function viewRun(store,id){
  const run=await getJSON(store,runKey(id));
  if(!run)return null;
  const stages=stageList(run.input);
  const stageData=await Promise.all(stages.map((_,i)=>getJSON(store,stageKey(id,i))));
  const completed=stageData.filter(x=>x?.status==='done').length;
  const hits=stageData.flatMap(x=>x?.status==='done' ? x.hits||[]:[]);
  const platformRows=collectPlatforms(hits,run.input).slice(0,run.input.max);
  const platforms=await Promise.all(platformRows.map(async p=>{
    const [global,edit]=await Promise.all([getJSON(store,globalKey(p.domain)),getJSON(store,editKey(id,p.domain))]);
    const base={...p,...(global||{}),...(edit||{})};
    base.matches=p.matches; // Last run's real SERP evidence always wins.
    base.publication={...p.publication,...(global?.publication||{}),...(edit?.publication||{})};
    const scored=evaluate(base,run.input,stages.length);
    return {...scored,brief:makeBrief(scored,run.input)};
  }));
  platforms.sort((a,b)=>(b.score??-1)-(a.score??-1)||b.scoreMin-a.scoreMin);
  return {id,createdAt:run.createdAt,input:run.input,stages:stages.map((st,i)=>({
    ...st,status:stageData[i]?.status||'pending',error:stageData[i]?.error||null,
    hits:stageData[i]?.hits?.length||0
  })),completed,total:stages.length,platforms,
    // Full organic evidence for Intelligence, including own site and known competitors.
    // Do not derive SEO positions from Publisher's intentionally filtered platform list.
    searchHits:hits.map(hit=>({
      engine:hit.engine,query:hit.query,position:hit.position,
      domain:hit.domain,url:hit.url,title:hit.title||'',snippet:hit.snippet||'',
      checkedAt:stageData[stages.findIndex(st=>st.engine===hit.engine&&st.query===hit.query)]?.checkedAt||null,
      source:'SerpApi organic_results'
    })),
    summary:{domains:platforms.length,hits:hits.length,confirmed:platforms.filter(x=>x.publication.status==='confirmed').length,
      high:platforms.filter(x=>x.priority==='Высокий').length,briefs:platforms.length,
      published:platforms.filter(x=>x.workStatus==='Опубликовано').length}};
}
async function action(request,store,body){
  const cmd=body.action;
  if(cmd==='status')return {configured:!!(process.env.MIRVIX_SERPAPI_KEY||process.env.SERPAPI_KEY),
    searchProvider:'SerpApi', siteAnalyzer:true, authenticated:true};
  if(cmd==='start'){
    const input=inputConfig(body.input);
    const stages=stageList(input);
    if(stages.length>20)throw Error('Слишком много поисковых запросов.');
    const id=randomUUID();
    await persist(store,runKey(id),{input,createdAt:isoNow()});
    await persist(store,'index/'+id,{id,domain:input.domain,brand:input.brand,region:input.region,
      createdAt:input.createdAt,queryCount:stages.length});
    return {id,total:stages.length};
  }
  if(cmd==='list'){
    const result=await store.list({prefix:'index/',paginate:false});
    const keys=(result.blobs||[]).slice(-80);
    const rows=(await Promise.all(keys.map(b=>getJSON(store,b.key)))).filter(Boolean)
      .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    return {runs:rows.slice(0,50)};
  }
  const id=requireId(body.id);
  const run=await getJSON(store,runKey(id));
  if(!run) return {error:'Запуск не найден.'};
  if(cmd==='view')return await viewRun(store,id);
  if(cmd==='step'){
    const stages=stageList(run.input);
    const idx=Number(body.index);
    if(!Number.isInteger(idx)||idx<0||idx>=stages.length)throw Error('Недопустимый шаг поиска.');
    const previous=await getJSON(store,stageKey(id,idx));
    if(previous?.status==='done')return {index:idx,cached:true,hits:previous.hits?.length||0};
    const stage=stages[idx];
    try{
      const hits=await querySerpApi(stage.query,stage.engine,run.input);
      await persist(store,stageKey(id,idx),{status:'done',checkedAt:isoNow(),hits});
      return {index:idx,hits:hits.length,engine:stage.engine,query:stage.query};
    }catch(e){
      await persist(store,stageKey(id,idx),{status:'error',error:err(e),checkedAt:isoNow()});
      return {index:idx,error:err(e)};
    }
  }
  if(cmd==='audit'){
    const brand=run.input.brand;
    const data=await audit.audit(run.input.url,brand);
    return {profile:{domain:run.input.domain,brand:brand||data?.extras?.title||'Не определён',
      title:data?.extras?.title||'',description:data?.extras?.description||'',
      serviceHeadings:data?.extras?.serviceHeadings||[],
      contentSnippet:data?.extras?.contentSnippet||'',
      audience:'Определяется специалистом',source:run.input.url,
      confidence:data?.extras?.title?'HTML metadata':'Недостаточно данных'},
      note:'Профиль сформирован только по доступной публичной странице. Проверьте полноту данных.'};
  }
  const domain=domainOf(body.domain);
  if(!domain||domain===run.input.domain)throw Error('Недопустимый домен площадки.');
  const current=await viewRun(store,id);
  const platform=current.platforms.find(p=>p.domain===domain);
  if(!platform)throw Error('Эта площадка отсутствует в результатах запуска.');
  if(cmd==='inspect'){
    // Public source discovery only: do not claim an editorial agreement or invent a price.
    // Existing audit reader pins public DNS and rejects unsafe redirects.
    const paths=['/advertising/','/contacts/','/write-for-us/','/reklama/','/contact/'];
    const pages=await Promise.all(paths.map(async (path)=>{
      const target=new URL(path,'https://'+domain+'/');
      try{
        const page=await audit.getText(target,90000,6500);
        if(page.status!==200 || !/text\/html/i.test(String(page.headers.get('content-type')||'text/html')))
          return null;
        const html=page.text||'';
        const text=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
          .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
          .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
        const terms=/(разместить|публикац|реклам|редакц|сотрудничест|guest post|sponsored|advertis|contact|контакт)/i;
        const at=text.search(terms);
        return {url:target.href,title:(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').slice(0,120),
          excerpt:(at>=0?text.slice(Math.max(0,at-160),at+550):text.slice(0,500)),
          mayContainTerms:at>=0,httpStatus:page.status,checkedAt:isoNow()};
      }catch{return null;}
    }));
    const candidates=pages.filter(Boolean);
    await persist(store,editKey(id,domain),{
      ...(await getJSON(store,editKey(id,domain))||{}),
      candidates,checkedAt:isoNow()
    });
    return {domain,candidates,notice:'Найденные страницы — только кандидаты для ручной проверки. Они не подтверждают возможность публикации и стоимость.'};
  }
  if(cmd==='edit'){
    const changes={};
    if(body.workStatus!==undefined){
      if(!WORK_STATUSES.includes(body.workStatus))throw Error('Неизвестный статус.');
      changes.workStatus=body.workStatus;
    }
    if(body.notes!==undefined)changes.notes=short(body.notes,1500);
    if(body.suggestedTopic!==undefined)changes.suggestedTopic=short(body.suggestedTopic,250);
    if(body.publishedUrl!==undefined){
      changes.publishedUrl=body.publishedUrl ? publicUrl(body.publishedUrl) : null;
      if(changes.publishedUrl && changes.workStatus==='Опубликовано')changes.publicationDate=isoNow();
    }
    if(body.quality!==undefined){
      if(body.quality===null || body.quality==='')changes.quality=null;
      else if(Number.isInteger(body.quality)&&body.quality>=0&&body.quality<=100)changes.quality=body.quality;
      else throw Error('Оценка качества должна быть 0–100.');
    }
    if(body.geographyEvidence!==undefined){
      if(body.geographyEvidence===null || body.geographyEvidence==='')changes.geographyEvidence=null;
      else if(Number.isInteger(body.geographyEvidence)&&body.geographyEvidence>=0&&body.geographyEvidence<=100)
        changes.geographyEvidence=body.geographyEvidence;
      else throw Error('Соответствие региону должно быть 0–100.');
    }
    if(body.price!==undefined){
      if(body.price===null || body.price==='')changes.price=null;
      else if(Number.isFinite(body.price)&&body.price>=0&&body.price<=100000000)changes.price=body.price;
      else throw Error('Стоимость должна быть числом от 0.');
    }
    if(body.contacts!==undefined)changes.contacts=String(body.contacts||'').split(/[,;\n]+/).map(x=>short(x,150)).filter(Boolean).slice(0,10);
    if(body.publication!==undefined){
      const pub=body.publication;
      if(!['unknown','confirmed','unavailable'].includes(pub.status))throw Error('Неизвестная доступность размещения.');
      if(pub.status==='confirmed' && (!pub.source || !pub.conditions))throw Error('Для подтверждения нужны источник и условия.');
      changes.publication={status:pub.status,source:pub.source?publicUrl(pub.source):null,
        conditions:short(pub.conditions,700),verifiedAt:pub.status==='confirmed'?isoNow():null};
    }
    const old=await getJSON(store,editKey(id,domain))||{};
    await persist(store,editKey(id,domain),{...old,...changes,updatedAt:isoNow()});
    // Reuse only verified site-level facts across clients, never per-client relevance/priority.
    const sharedFields=['publication','price','contacts','quality','geographyEvidence'];
    const shared={};for(const k of sharedFields)if(k in changes)shared[k]=changes[k];
    if(Object.keys(shared).length){
      const oldShared=await getJSON(store,globalKey(domain))||{};
      await persist(store,globalKey(domain),{...oldShared,...shared,domain,checkedAt:isoNow()});
    }
    return {updated:true};
  }
  throw Error('Неизвестное действие.');
}
export default async function handler(request){
  if(request.method!=='POST')return respond({error:'Используйте POST.'},405);
  if((Number(request.headers.get('content-length'))||0)>15000)return respond({error:'Слишком большой запрос.'},413);
  const url=new URL(request.url);
  const headers=Object.fromEntries(request.headers.entries());
  if(!isStaffRequest({headers:{...headers,host:url.host}}))
    return respond({error:'Требуется вход сотрудника в кабинете MIRVIX.'},403);
  let body;
  try{body=JSON.parse(await request.text());}catch{return respond({error:'Некорректный JSON.'},400);}
  // Old Publisher's direct SERP calls bypass the new per-tenant USD limits.
  // Existing read/export/edit actions are preserved; new paid searches use /platform/.
  if(body.action==='step')return respond({error:'Прямой поиск отключён до перехода на оплачиваемую очередь с лимитами. Используйте /platform/ → «Подключения».'},423);
  try{
    const store=db();
    if(body.action==='export'){
      const run=await viewRun(store,requireId(body.id));
      if(!run)return respond({error:'Запуск не найден.'},404);
      const rows=exportRows(run);
      const format=body.format==='csv'?'csv':'xlsx';
      const binary=format==='csv'?Buffer.from(csv(rows)):xlsx(rows);
      return new Response(binary,{headers:{
        'content-type':format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition':'attachment; filename="mirvix-geo-'+run.id.slice(0,8)+'.'+format+'"',
        'cache-control':'no-store','x-content-type-options':'nosniff'
      }});
    }
    return respond(await action(request,store,body));
  }catch(e){return respond({error:err(e)},422);}
}