// MIRVIX new individual-account UI; existing /cabinet/ is preserved separately.
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isConnections=location.pathname.startsWith('/connections/');
const selected={org:null,project:null};
let supabase=null,who=null,orgs=[];
const labels={serpapi:'SerpApi · Google и Яндекс',openai:'ChatGPT / OpenAI',gemini:'Google Gemini',
 perplexity:'Perplexity',grok:'Grok',deepseek:'DeepSeek',gigachat:'GigaChat',alice:'Яндекс Алиса AI Studio'};
const announce=(msg,type='')=>{const el=$('feedback');el.innerHTML=msg?'<div class="notice '+esc(type)+'">'+esc(msg)+'</div>':'';};
async function api(data){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)throw Error('Войдите в индивидуальный кабинет.');
 const response=await fetch('/.netlify/functions/mirvix-platform',{method:'POST',credentials:'same-origin',
  headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},
  body:JSON.stringify(data)});
 const output=await response.json().catch(()=>({error:'Недоступен JSON-ответ сервера'}));
 if(!response.ok)throw Error(output.error||'Сервер отклонил запрос '+response.status);
 return output;
}
async function doAction(task){try{await task();}catch(e){announce(e.message||String(e),'error');}}
const v=id=>$(id)?.value?.trim()||'';
const withOrg=()=>{if(!selected.org)throw Error('Выберите организацию.');return selected.org;};
const withProject=()=>{if(!selected.project)throw Error('Сначала создайте или выберите проект.');return selected.project;};
function fillSelect(el,rows,selectedId,placeholder,name='name'){
 if(!el)return;
 el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+
 rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===selectedId?' selected':'')+'>'+esc(row[name]||row.domain)+'</option>').join('');
}
async function loadOrganizations(){
 const result=await api({action:'session'});
 who=result;
 orgs=result.organizations||[];
 const last=selected.org;
 selected.org=orgs.some(o=>o.id===last)?last:orgs[0]?.id||null;
 fillSelect($('orgSelect'),orgs,selected.org,'Нет организаций');
 $('identity').textContent='Аккаунт: '+result.email+' · Роль: '+(result.staffRole||orgs.find(o=>o.id===selected.org)?.role||'клиент');
 if($('adminPanel'))$('adminPanel').classList.toggle('hidden',result.staffRole!=='admin');
 if($('processOne'))$('processOne').classList.toggle('hidden',result.staffRole!=='admin');
 if($('addProjectPanel'))$('addProjectPanel').classList.toggle('hidden',
   !(result.staffRole==='admin'||['owner','manager','editor'].includes(orgs.find(o=>o.id===selected.org)?.role)));
 await loadProjects();
}
async function loadProjects(){
 if(!selected.org){fillSelect($('projectSelect'),[],null,'Нет организации');selected.project=null;return;}
 const result=await api({action:'projects',organizationId:selected.org});
 const projects=result.projects||[];
 selected.project=projects.some(p=>p.id===selected.project)?selected.project:projects[0]?.id||null;
 fillSelect($('projectSelect'),projects,selected.project,'Выберите проект');
 if(isConnections)await loadConnections();
 else await loadJobs();
}
async function loadJobs(){
 if(!selected.org||!$('jobsRows'))return;
 const {jobs}=await api({action:'jobs',organizationId:selected.org,projectId:selected.project||undefined});
 $('jobsRows').innerHTML=jobs.length?jobs.map(j=>
  '<tr><td>'+esc(new Date(j.created_at).toLocaleString('ru-RU'))+'</td><td>'+esc(j.project_id.slice(0,8))+'</td><td>'+esc(j.job_type)+'</td><td><span class="status '+(j.status==='completed'?'good':j.status==='failed'?'bad':'')+'">'+esc(j.status)+'</span></td><td>'+esc(j.progress)+'%</td><td>'+esc(j.last_error||'—')+'</td></tr>').join('')
  :'<tr><td colspan="6">Для этого проекта пока нет заданий.</td></tr>';
}
async function showResults(){
 const {sections}=await api({action:'results',organizationId:withOrg(),projectId:withProject()});
 const area=$('resultsArea');
 area.innerHTML=Object.entries(sections).map(([name,rows])=>
  '<article class="card"><h3>'+esc({technical_audits:'Технические аудиты',
  search_observations:'Google / Яндекс',ai_results:'Ответы ИИ',traffic_metrics:'Трафик и обращения',
  promotion_tasks:'План продвижения',report_snapshots:'Отчёты'}[name]||name)+'</h3>'+
  '<p>'+rows.length+' записей сохранено</p>'+
  (rows.length?'<details><summary>Последние записи</summary><pre class="small" style="overflow:auto;max-height:280px">'+esc(JSON.stringify(rows.slice(0,3),null,2))+'</pre></details>':'')+'</article>').join('');
}
async function addOrg(){
 const result=await api({action:'create-organization',name:v('newOrg')});
 if(!result.organization)throw Error('Нет подтверждения создания организации.');
 selected.org=result.organization.id;announce('Организация создана.','success');await loadOrganizations();
}
async function createProject(){
 const result=await api({action:'create-project',organizationId:withOrg(),
  name:v('projectName'),domain:v('projectDomain'),region:v('projectRegion')});
 if(!result.project)throw Error('Проект не создан.');
 selected.project=result.project.id;announce('Проект создан.','success');await loadProjects();
}
async function invite(){
 const result=await api({action:'invite-user',organizationId:selected.org,
  email:v('inviteEmail'),role:v('inviteRole')});
 announce('Приглашение отправлено на '+result.email+'. UUID пользователя для назначения на проект: '+result.userId,'success');
 if($('assignedStaffId')&&result.role==='specialist')$('assignedStaffId').value=result.userId;
}
async function assignStaff(){
 const x=await api({action:'assign-specialist',organizationId:withOrg(),projectId:withProject(),
  staffUserId:v('assignedStaffId')});
 announce('Специалист '+x.staffUserId+' назначен на проект.','success');
}
async function queueAudit(){
 const result=await api({action:'enqueue',organizationId:withOrg(),projectId:withProject(),jobType:'site_audit'});
 announce('Аудит поставлен в очередь: '+result.jobId.slice(0,8)+'.','success');await loadJobs();
}
async function processOne(){
 const result=await api({action:'process-one'});announce(result.processed?'Шаг обработан: '+result.status:'В очереди пока нет заданий.',result.status==='failed'?'error':'success');
 if(isConnections)await loadConnections();else await loadJobs();
}
const classify=x=>x===true?'<span class="status good">Да</span>':x===false?'<span class="status bad">Нет</span>':'<span class="status">Не проверено</span>';
async function loadConnections(){
 if(!selected.org||!$('connectionsGrid'))return;
 if(who?.staffRole!=='admin'){
  $('connectionsGrid').innerHTML='<div class="notice">Доступ к проверке подключений имеет только администратор MIRVIX.</div>';
  return;
 }
 const c=await api({action:'connections',organizationId:selected.org});
 $('globalStatus').innerHTML='<strong>Глобальный запуск платных API: '+(c.paidEnabled?'ВКЛЮЧЁН':'ВЫКЛЮЧЕН')+'</strong>. '+esc(c.warning)+
  (c.paidEnabled?'':'<p>Без переменной MIRVIX_PAID_CHECKS_ENABLED=true никакой платный тест не выполняется.</p>');
 const checkMap=new Map((c.checks||[]).map(q=>[q.provider,q]));
 const limitMap=new Map((c.limits||[]).map(q=>[q.provider,q]));
 $('connectionsGrid').innerHTML=Object.entries(c.providers).map(([key,status])=>{
  const chk=checkMap.get(key),lim=limitMap.get(key);
  return '<article class="card" data-provider="'+esc(key)+'"><h3>'+esc(labels[key]||key)+'</h3>'+
  '<p>Переменная: <code>'+esc(status.required)+'</code></p>'+
  '<div class="checkrow"><span class="small">Ключ:</span>'+classify(status.keyPresent)+'</div>'+
  '<div class="checkrow"><span class="small">Реальный ответ:</span>'+classify(chk?.responded)+'</div>'+
  '<p class="small">Подтверждённый веб-поиск: '+(chk?.search_evidence===true?'да':chk?.search_evidence===false?'нет':'неизвестно')+
  '. Источники: '+(chk?.sources_count??'нет данных')+'.</p>'+
  '<p class="small">Счётчик вызовов <strong>'+(lim?.enabled?'разрешён':'выключен')+'</strong>; глобальный запрет действует независимо.</p>'+
  '<div class="grid two"><label>Максимум вызовов в сутки<input data-field="calls" type="number" min="0" max="10000" value="'+esc(lim?.max_daily_calls??0)+'"></label>'+
  '<label>Лимит USD/сутки<input data-field="usd" type="number" min="0" step=".001" max="10000" value="'+esc(lim?.max_daily_usd??0)+'"></label>'+
  '<label>Оценка USD/вызов<input data-field="price" type="number" min="0" step=".00001" max="10000" value="'+esc(lim?.estimate_per_call_usd??0)+'"></label>'+
  '<label class="checkrow" style="align-self:end"><input type="checkbox" data-field="enabled" '+(lim?.enabled?'checked':'')+'>Разрешить в пределах лимитов</label></div>'+
  '<div class="actions"><button data-click="budget" type="button" class="secondary">Сохранить лимиты</button>'+
  '<button data-click="probe" type="button" '+(!status.keyPresent||!c.paidEnabled?'disabled':'')+'>Реальный тест (1 вызов)</button></div>'+
  '</article>';
 }).join('');
 $('connectionsGrid').querySelectorAll('button[data-click]').forEach(btn=>btn.addEventListener('click',()=>{
  doAction(async()=>{
   const card=btn.closest('article'),provider=card.dataset.provider;
   if(btn.dataset.click==='budget'){
    const field=name=>card.querySelector('[data-field="'+name+'"]');
    const x=await api({action:'set-budget',organizationId:withOrg(),provider,
     enabled:field('enabled').checked,maxDailyCalls:Number(field('calls').value),
     maxDailyUsd:Number(field('usd').value),estimatePerCallUsd:Number(field('price').value)});
    announce('Лимит сохранён: '+provider+'. Глобальный платный режим '+(x.globalPaidEnabled?'включён.':'пока выключен.'),'success');
   }else{
    if(!selected.project)throw Error('Создайте или выберите проект для пробного запроса.');
    if(!confirm('Один реальный тест '+(labels[provider]||provider)+' может списать деньги. Лимиты должны быть заранее настроены. Продолжить?'))return;
    const x=await api({action:'probe',organizationId:withOrg(),projectId:withProject(),
     provider,engine:'google'});
    announce('Тест '+provider+' поставлен в очередь: '+x.jobId.slice(0,8)+'. Выполните один шаг в Preview.','success');
   }
  });
 }));
 $('checkRows').innerHTML=Object.entries(c.providers).map(([key,status])=>{
  const v=checkMap.get(key);
  return '<tr><td>'+esc(labels[key]||key)+'</td><td>'+esc(v?.checked_at?new Date(v.checked_at).toLocaleString('ru-RU'):'Никогда')+'</td><td>'+classify(v?.responded)+'</td><td>'+
   (v?.search_evidence===true?'Да':v?.search_evidence===false?'Нет':'Неизвестно')+'</td><td>'+esc(v?.sources_count??'—')+
   '</td><td>'+esc([v?.model,v?.error_code].filter(Boolean).join(' / ')||'—')+'</td></tr>';
 }).join('');
}
async function boot(){
 try{
  const conf=await fetch('/.netlify/functions/mirvix-platform?action=config',{cache:'no-store'}).then(r=>r.json());
  if(!conf.configured){
   announce('Supabase ещё не подключён. Примените SQL-миграции и добавьте SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY в Netlify. Подробности — /setup/.','error');return;
  }
  // Official supabase-js client handles Auth tokens, expiry, refresh and OTP links.
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
  supabase=createClient(conf.supabaseUrl,conf.supabaseAnonKey,{auth:{autoRefreshToken:true,persistSession:true,
   detectSessionInUrl:true,flowType:'implicit'}});
  const {data:{session}}=await supabase.auth.getSession();
  if(session)await showPrivate();
  $('loginSend')?.addEventListener('click',()=>doAction(async()=>{
   const email=v('loginEmail');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Введите корректный email.');
   const {error}=await supabase.auth.signInWithOtp({email,options:{
     emailRedirectTo:location.origin+(isConnections?'/connections/':'/platform/'),shouldCreateUser:false}});
   if(error)throw error;
   $('loginStatus').textContent='Проверьте электронную почту. Ссылка действует по настройкам Supabase Auth.';
  }));
  $('signOut')?.addEventListener('click',()=>doAction(async()=>{await supabase.auth.signOut();location.reload();}));
  $('orgSelect')?.addEventListener('change',()=>doAction(async()=>{selected.org=v('orgSelect');selected.project=null;await loadProjects();}));
  $('projectSelect')?.addEventListener('change',()=>doAction(async()=>{selected.project=v('projectSelect');if(!isConnections)await loadJobs();}));
  $('refresh')?.addEventListener('click',()=>doAction(loadOrganizations));
  for(const [id,fun]of Object.entries({addOrg,addProject:createProject,inviteUser:invite,
   assignStaff,queueAudit,refreshJobs:loadJobs,loadResults:showResults,processOne})){
   $(id)?.addEventListener('click',()=>doAction(fun));
  }
  supabase.auth.onAuthStateChange((event,session)=>{
   if(event==='SIGNED_IN'&&session)setTimeout(()=>doAction(showPrivate),0);
  });
 }catch(e){announce('Не удалось открыть безопасную авторизацию: '+(e.message||e),'error');}
}
async function showPrivate(){
 const {data:{session}}=await supabase.auth.getSession();if(!session)return;
 $('loginPanel').classList.add('hidden');
 $('private').classList.remove('hidden');
 await loadOrganizations();
}
boot();
