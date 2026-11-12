import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uuid,validDomain,providerStatus,memberRole,mayRead,mayWrite,mayReadProject,requireProject,requireMember,
 mustBeAdmin,paidSwitch,reserve,configured,HttpError} from '../netlify/lib/mirvix-platform.mjs';
import platform from '../netlify/functions/mirvix-platform.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ORG_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT_A={id:'11111111-1111-4111-8111-111111111111',staffRole:null,memberships:[{organization_id:ORG_A,role:'owner'}]};
const CLIENT_B={id:'22222222-2222-4222-8222-222222222222',staffRole:null,memberships:[{organization_id:ORG_B,role:'viewer'}]};
test('individual tenant memberships cannot read or write other clients',()=>{
 assert.ok(uuid(ORG_A));
 assert.equal(memberRole(CLIENT_A,ORG_A),'owner');
 assert.equal(mayRead(CLIENT_A,ORG_B),false);
 assert.equal(mayWrite(CLIENT_A,ORG_B),false);
 assert.throws(()=>requireMember(CLIENT_A,ORG_B),e=>e instanceof HttpError&&e.status===403);
 assert.throws(()=>requireMember(CLIENT_B,ORG_A),e=>e.status===403);
 assert.equal(mayRead(CLIENT_B,ORG_B),true);
 assert.equal(mayWrite(CLIENT_B,ORG_B),false);
 assert.throws(()=>requireMember(CLIENT_B,ORG_B,true),e=>e.status===403);
 assert.throws(()=>mustBeAdmin(CLIENT_A),e=>e.status===403);
 assert.doesNotThrow(()=>mustBeAdmin({...CLIENT_A,staffRole:'admin'}));
});
test('unsafe hosts and malformed project identifiers are rejected',()=>{
 for(const d of ['localhost','127.0.0.1','internal.local','example.com:8080','ex.com/path','user:pass@example.org','-bad.com'])
  assert.equal(validDomain(d),false,d);
 assert.equal(validDomain('clinic.example.ru'),true);
 assert.equal(uuid('12345'),false);
});
test('all eight integration adapters have a key name but never reveal its value',()=>{
 const s=providerStatus();
 assert.deepEqual(Object.keys(s).sort(),['serpapi','openai','gemini','perplexity','grok','deepseek','gigachat','alice'].sort());
 for(const x of Object.values(s)){
  assert.ok(x.required);
  assert.equal('key' in x,false);
 }
});
test('paid call reservation fails closed by default and cannot issue a network request',async()=>{
 const old=process.env.MIRVIX_PAID_CHECKS_ENABLED;
 delete process.env.MIRVIX_PAID_CHECKS_ENABLED;
 try{
  assert.equal(paidSwitch(),false);
  await assert.rejects(reserve(ORG_A,null,null,0,'openai','probe'),e=>e.status===423);
 }finally{if(old===undefined)delete process.env.MIRVIX_PAID_CHECKS_ENABLED;else process.env.MIRVIX_PAID_CHECKS_ENABLED=old;}
});
test('public configuration exposes only intended publishable Supabase details',async()=>{
 const res=await platform(new Request('https://preview.example/.netlify/functions/mirvix-platform?action=config'));
 const data=await res.json();
 assert.equal(res.status,200);
 assert.ok('configured' in data);
 assert.equal('serviceRoleKey' in data,false);
 assert.equal('SUPABASE_SERVICE_ROLE_KEY' in data,false);
 assert.ok(!JSON.stringify(data).includes(process.env.SUPABASE_SERVICE_ROLE_KEY||'__ABSENT__'));
});
test('API blocks anonymous writes and disallows cross-origin browser POST',async()=>{
 const missing=await platform(new Request('https://preview.example/.netlify/functions/mirvix-platform',{method:'POST',body:'{}',headers:{'content-type':'application/json'}}));
 assert.equal(missing.status,401);
 const hostile=await platform(new Request('https://preview.example/.netlify/functions/mirvix-platform',{method:'POST',body:'{}',
  headers:{origin:'https://evil.example','content-type':'application/json'}}));
 assert.equal(hostile.status,403);
});
test('RLS migration covers each tenant relation with owner-verified permissions',()=>{
 const sql=read('supabase/migrations/202611120001_mirvix_core.sql');
 const sql2=read('supabase/migrations/202611120002_paid_step_idempotency.sql');
 for(const name of ['organizations','org_memberships','projects','project_services','competitors',
  'query_clusters','target_queries','search_observations','ai_results','ai_citations',
  'technical_audits','traffic_metrics','promotion_tasks','report_snapshots',
  'api_limits','api_usage','integration_checks','analysis_jobs','analysis_job_steps']){
  assert.match(sql,new RegExp('create table if not exists public\\.'+name+'\\s*\\('),name);
 }
 assert.match(sql,/enable row level security/);
 assert.match(sql,/can_read_org\(organization_id\)/);
 assert.match(sql,/revoke all on public\./);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/security definer set search_path = ''/);
 assert.match(sql2,/unique_paid_job_step/);
 assert.match(sql2,/for update skip locked/);
 assert.match(sql2,/Paid step already attempted/);
});
test('worker and old routes enforce single paid step and no bypass',()=>{
 const jobs=read('netlify/lib/mirvix-jobs.mjs');
 const worker=read('netlify/functions/mirvix-scheduler.mjs');
 const direct=read('netlify/functions/direct-geo.mjs');
 const publisher=read('netlify/functions/geo-publisher.mjs');
 const prompts=read('netlify/functions/geo-prompts.mjs');
 assert.match(jobs,/await reserve\(job\.organization_id,job\.project_id,job\.id,step\.ordinal/);
 assert.match(worker,/config=\{schedule:/);
 assert.match(direct,/Прямые платные проверки временно заблокированы/);
 assert.match(publisher,/Прямой поиск отключён до перехода/);
 assert.match(prompts,/Прямая массовая генерация вопросов временно отключена/);
});
test('client UI is connected to authenticated server instead of mock results',()=>{
 const js=read('platform/app.js'),page=read('platform/index.html');
 const c=read('connections/index.html');
 assert.match(js,/signInWithOtp/);
 assert.match(js,/authorization:'Bearer '\+session\.access_token/);
 assert.match(js,/action:'job-detail'|action:'jobs'/);
 assert.match(js,/action:'set-budget'/);
 assert.match(page,/id="orgSelect"/);
 assert.match(c,/id="connectionsGrid"/);
 assert.doesNotMatch(js,/(?:sampleResponse|mockResults|fakeReport)\s*=/);
});

test('assigned specialist can see only their explicitly assigned client project',()=>{
 const p1='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const p2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const specialist={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',staffRole:'specialist',memberships:[],
  assignments:[{organization_id:ORG_A,project_id:p1}]};
 assert.equal(mayRead(specialist,ORG_A),true);
 assert.equal(mayRead(specialist,ORG_B),false);
 assert.equal(mayReadProject(specialist,ORG_A,p1),true);
 assert.equal(mayReadProject(specialist,ORG_A,p2),false);
 assert.equal(mayReadProject(specialist,ORG_B,p1),false);
 assert.throws(()=>requireProject(specialist,ORG_A,p2),e=>e.status===403);
 assert.doesNotThrow(()=>requireProject(specialist,ORG_A,p1));
 const sql=read('supabase/migrations/202611120003_staff_project_scopes.sql');
 assert.match(sql,/project_assignments/);
 assert.match(sql,/can_read_project\(%s,organization_id\)/);
 assert.match(sql,/case when rel='projects' then 'id' else 'project_id' end/);
 assert.match(sql,/public\.can_read_ai_result/);
 assert.match(sql,/public\.can_read_job/);
 const server=read('netlify/functions/mirvix-platform.mjs');
 assert.match(server,/requireProject\(user,org,cid\(id\)\)/);
 assert.match(server,/action==='assign-specialist'/);
});
