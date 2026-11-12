// MIRVIX multi-tenant Supabase REST gateway. Service-role key never leaves server.
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PROVIDERS=Object.freeze({
  serpapi:{env:'MIRVIX_SERPAPI_KEY',fallback:'SERPAPI_KEY',web:true},
  openai:{env:'OPENAI_API_KEY',web:true},gemini:{env:'GEMINI_API_KEY',web:true},
  perplexity:{env:'PERPLEXITY_API_KEY',web:true},grok:{env:'XAI_API_KEY',web:true},
  deepseek:{env:'DEEPSEEK_API_KEY',web:true},gigachat:{env:'GIGACHAT_AUTH_KEY',web:false},
  alice:{env:'YANDEX_API_KEY',extra:'YANDEX_FOLDER_ID',web:true}
});
export function uuid(x){return typeof x==='string'&&ID.test(x);}
export function configured(){
 const url=process.env.SUPABASE_URL||'';
 const publishable=process.env.SUPABASE_ANON_KEY||'';
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 return /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url)&&
  publishable.length>20&&secret.length>20;
}
function credentials(){
 if(!configured())throw new HttpError(503,'Supabase не подключён. Сначала выполните SQL-миграции и настройте переменные Netlify.');
 return {url:process.env.SUPABASE_URL.replace(/\/+$/,''),publicKey:process.env.SUPABASE_ANON_KEY,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY};
}
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const shorten=x=>String(x||'').replace(/Bearer\s+\S+/ig,'Bearer [скрыто]').slice(0,350);
export async function rest(path,{method='GET',query={},body,prefer='',asUser=false,token}={}){
 const c=credentials(),url=new URL(c.url+'/rest/v1/'+path);
 for(const [key,value]of Object.entries(query)){if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));}
 const key=asUser?c.publicKey:c.serviceKey;
 const headers={'apikey':key,'authorization':'Bearer '+(asUser?token:key),'content-type':'application/json'};
 if(prefer)headers.prefer=prefer;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
 try{
  const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:ctl.signal,redirect:'error'});
  const data=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok)throw new HttpError(response.status,'Supabase: '+shorten(data?.message||data?.error||'HTTP '+response.status));
  return data;
 }finally{clearTimeout(timer);}
}
export async function trustedUser(bearer){
 if(typeof bearer!=='string'||!/^Bearer [A-Za-z0-9._~-]{20,5000}$/i.test(bearer))throw new HttpError(401,'Требуется индивидуальный вход через Supabase Auth.');
 const c=credentials(),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
 try{
  const res=await fetch(c.url+'/auth/v1/user',{headers:{apikey:c.publicKey,authorization:bearer},signal:ctl.signal,redirect:'error'});
  if(!res.ok)throw new HttpError(401,'Сессия истекла. Войдите повторно.');
  const u=await res.json();
  if(!uuid(u?.id)||u?.role==='service_role')throw new HttpError(401,'Недействительный пользователь.');
  return {id:u.id,email:u.email||''};
 }finally{clearTimeout(timer);}
}
export async function identity(bearer){
 const user=await trustedUser(bearer);
 const [staff,members,assignments]=await Promise.all([
  rest('platform_staff',{query:{user_id:'eq.'+user.id,select:'user_id,role',limit:1}}),
  rest('org_memberships',{query:{user_id:'eq.'+user.id,select:'organization_id,role'}}),
  rest('project_assignments',{query:{user_id:'eq.'+user.id,select:'organization_id,project_id'}})
 ]);
 return {...user,staffRole:staff?.[0]?.role||null,memberships:members||[],assignments:assignments||[]};
}
export function memberRole(user,org){
 if(user.staffRole==='admin')return 'admin';
 const m=user.memberships?.find(x=>x.organization_id===org);
 if(m)return m.role;
 if(user.staffRole==='specialist'&&user.assignments?.some(a=>a.organization_id===org))return 'specialist';
 return null;
}
export function mayRead(user,org){return !!memberRole(user,org);}
export function mayWrite(user,org){const r=memberRole(user,org);return ['admin','specialist','owner','manager','editor'].includes(r);}
export function mayReadProject(user,org,project){
 if(user.staffRole==='admin')return true;
 if(user.memberships?.some(m=>m.organization_id===org))return true;
 return user.staffRole==='specialist'&&user.assignments?.some(a=>a.organization_id===org&&a.project_id===project);
}
export function mayWriteProject(user,org,project){
 return mayReadProject(user,org,project)&&mayWrite(user,org);
}
export function requireMember(user,org,write=false){
 if(!uuid(org)||!(write?mayWrite(user,org):mayRead(user,org)))throw new HttpError(403,'Нет прав на данные этой организации.');
}
export function requireProject(user,org,project,write=false){
 if(!uuid(org)||!uuid(project)||!(write?mayWriteProject(user,org,project):mayReadProject(user,org,project)))
  throw new HttpError(403,'Нет доступа к этому проекту.');
}
export function mustBeAdmin(user){if(user.staffRole!=='admin')throw new HttpError(403,'Нужны права администратора MIRVIX.');}
export function providerStatus(){
 return Object.fromEntries(Object.entries(PROVIDERS).map(([id,cfg])=>
  [id,{id,keyPresent:!!(process.env[cfg.env]||(cfg.fallback&&process.env[cfg.fallback]))&&(!cfg.extra||!!process.env[cfg.extra]),expectedWeb:cfg.web,
    required:cfg.extra?cfg.env+' + '+cfg.extra:cfg.env}]));
}
export const paidSwitch=()=>process.env.MIRVIX_PAID_CHECKS_ENABLED==='true';
export async function reserve(org,project,job,ordinal,provider,kind){
 if(!paidSwitch())throw new HttpError(423,'Платные вызовы выключены. Администратор должен включить MIRVIX_PAID_CHECKS_ENABLED и задать лимиты.');
 if(!PROVIDERS[provider])throw new HttpError(422,'Неизвестный провайдер.');
 const status=providerStatus()[provider];
 if(!status.keyPresent)throw new HttpError(503,'Ключ '+provider+' не настроен.');
 const result=await rest('rpc/reserve_step_api_usage',{method:'POST',body:{
  p_org:org,p_provider:provider,p_project:project,p_job:job,p_step:ordinal,p_kind:kind
 }});
 if(!uuid(result))throw new HttpError(503,'Не удалось подтвердить резервирование бюджета.');
 return result;
}
export const limitedError=e=>e instanceof HttpError?e:new HttpError(502,'Не удалось завершить запрос. '+shorten(e?.message));
export function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
export function sameOrigin(request){
 const origin=request.headers.get('origin');if(!origin)return true;
 try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}
}
export function validDomain(s){
 if(typeof s!=='string'||s.length>253)return false;
 return /^(?=.{4,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(s) &&
  !/(^|\.)localhost$|(^|\.)local$|(^|\.)internal$/i.test(s) &&
  !/^\d+(?:\.\d+){3}$/.test(s);
}
