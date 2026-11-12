import {rest,uuid,reserve,limitedError,HttpError} from './mirvix-platform.mjs';
import { _test as siteAudit } from '../functions/site-audit.mjs';
import {querySerpApi} from '../functions/geo-publisher.mjs';
import {executeProviderQuery} from '../functions/direct-geo.mjs';

const clip=x=>String(x||'').replace(/Bearer\s+\S+/gi,'Bearer [скрыто]').slice(0,320);
async function patch(table,id,body,extra={}){
 return rest(table,{method:'PATCH',query:{id:'eq.'+id,...extra},body,prefer:'return=representation'});
}
async function persistCheck(job,step,status,result,error){
 const p=step.payload||{},provider=p.provider||'serpapi';
 if(p.probe!==true)return;
 await rest('integration_checks',{method:'POST',query:{on_conflict:'organization_id,provider'},prefer:'resolution=merge-duplicates,return=minimal',
  body:{organization_id:job.organization_id,provider,key_present:true,
   responded:status==='completed',search_evidence:result?.searchEvidence??(p.provider==='serpapi'?true:null),
   sources_count:result?.sources?.length??(result?.hits?.length||0),
   model:result?.model||null,error_code:error?clip(error):null,checked_at:new Date().toISOString()}
 });
}
async function stepAction(job,step,project){
 const data=step.payload||{};
 if(step.step_type==='site_audit'){
  const result=await siteAudit.audit('https://'+project.domain,project.name);
  await rest('technical_audits',{method:'POST',query:{on_conflict:'job_id'},prefer:'resolution=merge-duplicates',body:{
   organization_id:job.organization_id,project_id:job.project_id,job_id:job.id,
   checked_at:new Date().toISOString(),score:result.geoScore??null,
   coverage_percent:result.coveragePercent??null,
   summary:{geoScore:result.geoScore??null,coveragePercent:result.coveragePercent??null,
    checked:result.checked,unknown:result.unknown,issuesCount:result.issuesCount},
   findings:result.recommendations||[]
  }});
  return {checkedAt:new Date().toISOString(),score:result.geoScore??null,
   issues:result.issuesCount||0,source:'MIRVIX site-audit'};
 }
 if(step.step_type==='serp'){
  const provider='serpapi';
  const usageId=await reserve(job.organization_id,job.project_id,job.id,step.ordinal,provider,'organic_serp');
  try{
   const hits=await querySerpApi(data.query,data.engine,{region:data.region,gl:data.gl,lr:data.lr});
   const observedAt=new Date().toISOString();
   if(hits.length){
    await rest('search_observations',{method:'POST',query:{on_conflict:'job_id,step_ordinal,engine,found_url'},prefer:'resolution=merge-duplicates',body:hits.map(hit=>({
     organization_id:job.organization_id,project_id:job.project_id,job_id:job.id,step_ordinal:step.ordinal,
     engine:data.engine,query:data.query,region:data.region||'',
     position:hit.position??null,found_domain:hit.domain,
     found_url:hit.url,source:'SerpApi organic_results',checked_at:observedAt,
     result:{title:hit.title||'',snippet:hit.snippet||''}
    }))});
   }
   await patch('api_usage',usageId,{status:'completed',response_code:'success'});
   const output={query:data.query,engine:data.engine,hits:hits.length,checkedAt:observedAt,
     searchEvidence:true,sources:hits.slice(0,5).map(x=>({url:x.url}))};
   await persistCheck(job,step,'completed',output,null);
   return output;
  }catch(error){
   await patch('api_usage',usageId,{status:'error',response_code:clip(error.message||'failed')}).catch(()=>{});
   await persistCheck(job,step,'error',null,error.message).catch(()=>{});
   throw error;
  }
 }
 if(step.step_type==='ai'){
  const provider=data.provider;
  const usageId=await reserve(job.organization_id,job.project_id,job.id,step.ordinal,provider,'ai_web_probe');
  try{
   const response=await executeProviderQuery({provider,prompt:data.prompt,brand:project.name,
     domain:project.domain,competitors:[]});
   const resultRow={
     organization_id:job.organization_id,project_id:job.project_id,job_id:job.id,step_ordinal:step.ordinal,
     provider,model:response.model||null,prompt:data.prompt,answer:response.answer,
     brand_mentioned:response.brandMention,brand_cited:response.sourceMention,
     search_evidence:response.searchEvidence,response_status:'answered',
     checked_at:response.checkedAt,sources:response.sources||[],competitors:response.competitorsMentioned||[]
   };
   const rows=await rest('ai_results',{method:'POST',query:{on_conflict:'job_id,step_ordinal'},body:resultRow,prefer:'resolution=merge-duplicates,return=representation'});
   if(rows?.[0]&&response.sources?.length){
    await rest('ai_citations',{method:'POST',query:{on_conflict:'result_id,url'},prefer:'resolution=merge-duplicates',body:response.sources.slice(0,30).map(s=>({
      organization_id:job.organization_id,result_id:rows[0].id,
      url:s.url,title:s.title||null,cited_domain:(()=>{try{return new URL(s.url).hostname;}catch{return null;}})(),checked_at:response.checkedAt
    }))});
   }
   await patch('api_usage',usageId,{status:'completed',response_code:'success'});
   await persistCheck(job,step,'completed',response,null);
   return {provider,prompt:data.prompt,model:response.model,checkedAt:response.checkedAt,
     brandMention:response.brandMention,searchEvidence:response.searchEvidence,
     sources:response.sources||[]};
  }catch(error){
   await patch('api_usage',usageId,{status:'error',response_code:clip(error.message||'failed')}).catch(()=>{});
   await persistCheck(job,step,'error',null,error.message).catch(()=>{});
   throw error;
  }
 }
 throw new HttpError(422,'Неизвестный шаг очереди.');
}
export async function processOne(){
 const claimed=await rest('rpc/claim_analysis_job',{method:'POST',body:{}});
 const job=Array.isArray(claimed)?claimed[0]:null;
 if(!job)return {processed:false,message:'Нет готовых заданий.'};
 if(!uuid(job.id)||!uuid(job.organization_id)||!uuid(job.project_id))throw Error('Invalid database job');
 const [projects,steps]=await Promise.all([
  rest('projects',{query:{id:'eq.'+job.project_id,organization_id:'eq.'+job.organization_id,select:'id,organization_id,domain,name',limit:1}}),
  rest('analysis_job_steps',{query:{job_id:'eq.'+job.id,organization_id:'eq.'+job.organization_id,select:'*',order:'ordinal.asc',limit:100}})
 ]);
 const project=projects?.[0],next=steps?.find(s=>s.status!=='completed');
 const leaseQuery={lease_token:'eq.'+job.lease_token};
 if(!project||!steps?.length){
  await patch('analysis_jobs',job.id,{status:'failed',last_error:'Не найдены проект или шаги',finished_at:new Date().toISOString(),lease_until:null},leaseQuery);
  return {processed:true,id:job.id,status:'failed'};
 }
 if(!next){
  await patch('analysis_jobs',job.id,{status:'completed',progress:100,finished_at:new Date().toISOString(),lease_until:null},leaseQuery);
  return {processed:true,id:job.id,status:'completed'};
 }
 try{
  const output=await stepAction(job,next,project);
  await patch('analysis_job_steps',next.id,{status:'completed',result:output,error:null,completed_at:new Date().toISOString()});
  const completed=steps.filter(s=>s.status==='completed').length+1,total=steps.length;
  const finished=completed===total;
  const status=finished?'completed':'queued';
  await patch('analysis_jobs',job.id,{status,progress:Math.round(completed/total*100),
   lease_until:null,lease_token:null,run_after:new Date(Date.now()+1000).toISOString(),
   finished_at:finished?new Date().toISOString():null,
   result_summary:finished?{completed,total}:null},leaseQuery);
  return {processed:true,id:job.id,status,progress:Math.round(completed/total*100)};
 }catch(error){
  const message=clip(error?.message||'Ошибка шага');
  const fatal=/already attempted|уже.*использ|повторн.*оплат/i.test(message);
  const attempts=job.attempts+1,failed=fatal||attempts>=job.max_attempts;
  await patch('analysis_job_steps',next.id,{status:'error',error:message}).catch(()=>{});
  await patch('analysis_jobs',job.id,{status:failed?'failed':'queued',attempts,
   lease_token:null,lease_until:null,run_after:new Date(Date.now()+60_000*attempts).toISOString(),
   last_error:message,finished_at:failed?new Date().toISOString():null},leaseQuery);
  return {processed:true,id:job.id,status:failed?'failed':'retry_scheduled',error:message};
 }
}
