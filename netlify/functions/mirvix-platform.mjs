import {configured,rest,identity,requireMember,mustBeAdmin,mayWrite,validDomain,
 json,providerStatus,PROVIDERS,paidSwitch,HttpError,limitedError,sameOrigin,uuid} from '../lib/mirvix-platform.mjs';
import {processOne} from '../lib/mirvix-jobs.mjs';

const text=(x,max=200)=>String(x??'').trim().slice(0,max);
const authBearer=req=>req.headers.get('authorization')||'';
const safeName=s=>typeof s==='string'&&s.trim().length>=2&&s.trim().length<=180;
const cid=s=>{if(!uuid(s))throw new HttpError(422,'Недействительный идентификатор.');return s;};
function checkProject(projects,org,project){const p=projects?.[0];if(!p||p.organization_id!==org)throw new HttpError(404,'Проект этой организации не найден.');return p;}
const ownProject=async (org,id)=>checkProject(await rest('projects',{query:{organization_id:'eq.'+org,id:'eq.'+cid(id),select:'id,organization_id,name,domain,region',limit:1}}),org,id);
function requireAdminOrManager(user,org){
 if(!mayWrite(user,org))throw new HttpError(403,'Нет права запускать проверки.');
}
async function orgInfo(user){
 const orgs=await rest('organizations',{query:{select:'id,name,created_at',order:'created_at.desc',limit:150}});
 const allowed=user.staffRole?orgs:orgs.filter(o=>user.memberships.some(m=>m.organization_id===o.id));
 return allowed.map(o=>({...o,role:user.staffRole||user.memberships.find(m=>m.organization_id===o.id)?.role}));
}
async function invite(email,redirectTo){
 const url=new URL(process.env.SUPABASE_URL.replace(/\/+$/,'')+'/auth/v1/invite');
 url.searchParams.set('redirect_to',redirectTo);
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
 try{
  const response=await fetch(url,{method:'POST',signal:ctl.signal,redirect:'error',
   headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},
   body:JSON.stringify({email,data:{platform:'mirvix'}})});
  const v=await response.json().catch(()=>({}));
  if(!response.ok||!uuid(v.id))throw new HttpError(response.status||502,
   'Не удалось отправить Supabase приглашение. Проверьте почтовые настройки и URL redirect.');
  return {id:v.id,email:v.email};
 }finally{clearTimeout(timer);}
}
async function createJob(user,body,probe=false){
 const org=cid(body.organizationId),project=await ownProject(org,body.projectId);
 requireMember(user,org,true);
 const type=probe?(body.provider==='serpapi'?'serp_scan':'ai_matrix'):body.jobType;
 if(!['site_audit','serp_scan','ai_matrix'].includes(type))throw new HttpError(422,'Неизвестный тип проверки.');
 const paid=type!=='site_audit';
 if(paid){
  mustBeAdmin(user); // Only platform administrators can request paid work.
  if(!paidSwitch())throw new HttpError(423,'Платные вызовы выключены переменной MIRVIX_PAID_CHECKS_ENABLED.');
 }
 let steps=[];
 if(type==='site_audit')steps=[{step_type:'site_audit',payload:{}}];
 else if(type==='serp_scan'){
  const engine=body.engine;
  if(!['google','yandex'].includes(engine))throw new HttpError(422,'Выберите Google или Яндекс.');
  const qs=(probe?['мрт Санкт-Петербург']:body.queries);
  if(!Array.isArray(qs)||qs.length<1||qs.length>5)throw new HttpError(422,'От 1 до 5 проверяемых запросов.');
  const region=text(body.region||project.region||'Санкт-Петербург, Россия',120);
  const gl=text(body.gl||'ru',2);
  const lr=text(body.lr||'2',5);
  if(!/^[a-z]{2}$/.test(gl)||!/^\d{1,5}$/.test(lr))throw new HttpError(422,'Неверная настройка региона.');
  steps=qs.map(q=>({step_type:'serp',payload:{engine,query:text(q,160),region,gl,lr,probe}}));
  if(steps.some(s=>s.payload.query.length<5))throw new HttpError(422,'Поисковый запрос слишком короткий.');
 }else{
  const prov=body.provider;
  if(!PROVIDERS[prov]||prov==='serpapi')throw new HttpError(422,'Выберите ИИ-провайдера.');
  const prompts=probe?['Порекомендуй компании, которые делают МРТ в Санкт-Петербурге.']:body.queries;
  if(!Array.isArray(prompts)||prompts.length<1||prompts.length>3)throw new HttpError(422,'От 1 до 3 вопросов на запуск.');
  steps=prompts.map(p=>({step_type:'ai',payload:{provider:prov,prompt:text(p,320),probe}}));
  if(steps.some(s=>s.payload.prompt.length<12))throw new HttpError(422,'Вопрос ИИ должен быть не короче 12 символов.');
 }
 if(paid){
  const names=[...new Set(steps.map(s=>s.step_type==='serp'?'serpapi':s.payload.provider))];
  for(const provider of names){
   if(!providerStatus()[provider].keyPresent)throw new HttpError(503,'Ключ '+provider+' отсутствует.');
   const lim=await rest('api_limits',{query:{organization_id:'eq.'+org,provider:'eq.'+provider,select:'enabled,max_daily_calls,max_daily_usd,estimate_per_call_usd',limit:1}});
   const l=lim?.[0];
   if(!l?.enabled||Number(l.max_daily_calls)<steps.length||Number(l.max_daily_usd)<=0||Number(l.estimate_per_call_usd)<=0)
    throw new HttpError(423,'Сначала разрешите провайдера '+provider+' и настройте положительные дневные лимиты.');
  }
 }
 const rows=await rest('analysis_jobs',{method:'POST',prefer:'return=representation',body:{
  organization_id:org,project_id:project.id,job_type:type,requested_by:user.id,max_attempts:3
 }});
 const job=rows?.[0];if(!job)throw new HttpError(502,'Не удалось создать задание.');
 try{
  await rest('analysis_job_steps',{method:'POST',body:steps.map((step,ordinal)=>({
   organization_id:org,job_id:job.id,ordinal,...step
  }))});
 }catch(error){
  await rest('analysis_jobs',{method:'DELETE',query:{id:'eq.'+job.id}}).catch(()=>{});
  throw error;
 }
 return {jobId:job.id,type,status:'queued',steps:steps.length,message:'Задание сохранено на сервере. Его можно продолжить после закрытия вкладки.'};
}
async function action(user,data,request){
 const action=data.action;
 if(action==='session')return {id:user.id,email:user.email,staffRole:user.staffRole,memberships:user.memberships,
  organizations:await orgInfo(user)};
 if(action==='organizations')return {organizations:await orgInfo(user)};
 if(action==='create-organization'){
  mustBeAdmin(user);
  if(!safeName(data.name))throw new HttpError(422,'Укажите название организации.');
  const rows=await rest('organizations',{method:'POST',body:{name:text(data.name,180)},prefer:'return=representation'});
  return {organization:rows?.[0]};
 }
 if(action==='invite-user'){
  mustBeAdmin(user);
  const org=data.organizationId?cid(data.organizationId):null;
  const email=text(data.email,254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))throw new HttpError(422,'Некорректный email.');
  const role=data.role;
  if(!['admin','specialist','owner','manager','editor','viewer'].includes(role))throw new HttpError(422,'Некорректная роль.');
  if(!['admin','specialist'].includes(role)&&!org)throw new HttpError(422,'Для клиента нужна организация.');
  if(org){const rows=await rest('organizations',{query:{id:'eq.'+org,select:'id',limit:1}});if(!rows?.length)throw new HttpError(404,'Организация не найдена.');}
  const publicUrl=new URL(request.url);
  const userRecord=await invite(email,publicUrl.origin+'/platform/');
  if(['admin','specialist'].includes(role))await rest('platform_staff',{method:'POST',query:{on_conflict:'user_id'},
    prefer:'resolution=merge-duplicates',body:{user_id:userRecord.id,role}});
  else await rest('org_memberships',{method:'POST',query:{on_conflict:'organization_id,user_id'},
    prefer:'resolution=merge-duplicates',body:{organization_id:org,user_id:userRecord.id,role}});
  return {invited:true,email:userRecord.email,role,organizationId:org};
 }
 if(action==='projects'){
  const org=cid(data.organizationId);requireMember(user,org);
  const rows=await rest('projects',{query:{organization_id:'eq.'+org,select:'id,name,domain,region,status,created_at',order:'created_at.desc',limit:150}});
  return {projects:rows};
 }
 if(action==='create-project'){
  const org=cid(data.organizationId);requireMember(user,org,true);
  const name=text(data.name,180),domain=text(data.domain,253).replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  if(!safeName(name)||!validDomain(domain))throw new HttpError(422,'Проверьте название и публичный домен.');
  const rows=await rest('projects',{method:'POST',prefer:'return=representation',
   body:{organization_id:org,name,domain,region:text(data.region,150)}});
  return {project:rows?.[0]};
 }
 if(action==='jobs'){
  const org=cid(data.organizationId);requireMember(user,org);
  const query={organization_id:'eq.'+org,select:'id,project_id,job_type,status,progress,attempts,last_error,created_at,finished_at',
   order:'created_at.desc',limit:50};
  if(data.projectId){await ownProject(org,data.projectId);query.project_id='eq.'+data.projectId;}
  return {jobs:await rest('analysis_jobs',{query})};
 }
 if(action==='job-detail'){
  const org=cid(data.organizationId);requireMember(user,org);
  const rows=await rest('analysis_jobs',{query:{id:'eq.'+cid(data.jobId),organization_id:'eq.'+org,select:'*',limit:1}});
  if(!rows?.length)throw new HttpError(404,'Задание не найдено.');
  const steps=await rest('analysis_job_steps',{query:{organization_id:'eq.'+org,job_id:'eq.'+rows[0].id,select:'ordinal,step_type,status,result,error,completed_at',order:'ordinal.asc',limit:100}});
  return {job:rows[0],steps};
 }
 if(action==='results'){
  const org=cid(data.organizationId);requireMember(user,org);
  const p=await ownProject(org,data.projectId);
  const names=['technical_audits','search_observations','ai_results','traffic_metrics','promotion_tasks','report_snapshots'];
  const dataRows=await Promise.all(names.map(table=>rest(table,{query:{organization_id:'eq.'+org,project_id:'eq.'+p.id,
   select:'*',limit:50}})));
  return {project:p,sections:Object.fromEntries(names.map((name,i)=>[name,dataRows[i]]))};
 }
 if(action==='enqueue')return createJob(user,data);
 if(action==='connections'){
  mustBeAdmin(user);
  const org=cid(data.organizationId);
  const checks=await rest('integration_checks',{query:{organization_id:'eq.'+org,select:'*'}});
  const limits=await rest('api_limits',{query:{organization_id:'eq.'+org,select:'*'}});
  return {supabaseConfigured:configured(),paidEnabled:paidSwitch(),providers:providerStatus(),
   checks,limits,warning:'Наличие ключа не подтверждает работу API. Пробные платные вызовы требуют явных положительных лимитов.'};
 }
 if(action==='set-budget'){
  mustBeAdmin(user);const org=cid(data.organizationId),provider=data.provider;
  if(!PROVIDERS[provider])throw new HttpError(422,'Неизвестный провайдер.');
  const enabled=data.enabled===true,calls=Number(data.maxDailyCalls),
    usd=Number(data.maxDailyUsd),price=Number(data.estimatePerCallUsd);
  if(!Number.isInteger(calls)||calls<0||calls>10000||!Number.isFinite(usd)||usd<0||usd>10000||
   !Number.isFinite(price)||price<0||price>10000)throw new HttpError(422,'Недопустимые лимиты.');
  if(enabled&&(!calls||usd<=0||price<=0||usd<price))throw new HttpError(422,'Для включения установите положительные лимиты и оценку стоимости вызова.');
  await rest('api_limits',{method:'POST',query:{on_conflict:'organization_id,provider'},prefer:'resolution=merge-duplicates',
   body:{organization_id:org,provider,enabled,max_daily_calls:calls,max_daily_usd:usd,estimate_per_call_usd:price,updated_at:new Date().toISOString()}});
  return {saved:true,provider,enabled,globalPaidEnabled:paidSwitch()};
 }
 if(action==='probe'){
  mustBeAdmin(user);
  return createJob(user,{organizationId:data.organizationId,projectId:data.projectId,
   provider:data.provider,engine:data.engine||'google'},true);
 }
 if(action==='process-one'){
  mustBeAdmin(user);
  return processOne();
 }
 throw new HttpError(404,'Неизвестное действие платформы.');
}
export default async function handler(request){
 if(request.method==='GET'){
  const u=new URL(request.url);
  if(u.searchParams.get('action')!=='config')return json({error:'Not found'},404);
  return json({configured:configured(),supabaseUrl:configured()?process.env.SUPABASE_URL:null,
   supabaseAnonKey:configured()?process.env.SUPABASE_ANON_KEY:null,
   authMode:'supabase-individual-otp',paidEnabled:paidSwitch()});
 }
 if(request.method!=='POST')return json({error:'POST required'},405);
 if(!sameOrigin(request))return json({error:'Origin mismatch'},403);
 const size=Number(request.headers.get('content-length')||0);
 if(size>12000)return json({error:'Body too large'},413);
 try{
  const user=await identity(authBearer(request));
  const raw=await request.text();
  if(raw.length>12000)throw new HttpError(413,'Запрос слишком большой.');
  const data=JSON.parse(raw);
  const output=await action(user,data,request);
  return json(output);
 }catch(error){
  const e=limitedError(error);
  return json({error:e.message},e.status);
 }
}
