import {seoAnalysis,aiAnalysis,priorityActions,trafficSummary} from '/netlify/lib/geo-intelligence-core.mjs';

const $=id=>document.getElementById(id);
const clean=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={run:null,seo:null,ai:null,aiResults:[],audit:null,traffic:trafficSummary(null),providers:[],promptEvidence:[],stopped:false,busy:false};
function flash(s,t=''){ $('flash').innerHTML=s?'<div class="notice '+clean(t)+'">'+clean(s)+'</div>':''; }
async function post(endpoint,body){
 const response=await fetch('/.netlify/functions/'+endpoint,{method:'POST',credentials:'same-origin',
 headers:{'content-type':'application/json','x-mirvix-cabinet':'1'},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({error:'Некорректный ответ сервера'}));
 if(!response.ok)throw Error(data.error||'Ошибка API '+response.status);
 return data;
}
async function boot(){
 try{
  const auth=await post('cabinet-auth',{action:'status'});
  if(auth.role!=='staff'){
   $('auth').innerHTML='Необходимо <a href="/cabinet/">войти как сотрудник MIRVIX AI</a> в этом же домене. Доступ партнёрам не предоставляется.';
   return;
  }
  $('auth').classList.add('hidden');$('work').classList.remove('hidden');
  const [runs,available]=await Promise.all([
   post('geo-publisher',{action:'list'}).catch(()=>({runs:[]})),
   post('direct-geo',{action:'config'}).catch(e=>({available:[],error:e.message}))
  ]);
  for(const item of runs.runs||[])$('run').add(new Option(
   new Date(item.createdAt).toLocaleDateString('ru-RU')+' · '+(item.brand||item.domain)+' · '+item.region,item.id));
  S.providers=available.available||[];
  $('providers').innerHTML=S.providers.map(p=>'<label class="provider toggle"><input type="checkbox" value="'+clean(p.id)+'" '+(p.configured&&p.mode!=='model-only'?'checked':'')+(p.configured?'':' disabled')+'><span>'+clean(p.name.replace(/ · .*/,''))+'<small class="hint" style="display:block">'+
   (p.configured? (p.mode==='model-only'?'без веб-поиска':'API подключён'):'ключ отсутствует')+'</small></span></label>').join('');
  if(available.error)flash('Подключения ИИ: '+available.error,'error');
  else if(!(runs.runs||[]).length)flash('Нет сохранённых поисковых запусков. Откройте GEO Publisher и проведите первичный поиск.');
 }catch(e){$('auth').textContent='Не удалось открыть панель: '+e.message;}
}
function getConfirmedDomains(){return $('competitorDomains').value.split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,25);}
function recalcCompetitors(){if(!S.run)return;S.seo=seoAnalysis({...S.run.input,competitors:getConfirmedDomains()},S.run.searchHits||[]);renderSEO();renderRivals();renderAll();}
function stripDomain(d){return String(d||'').replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'').toLowerCase();}
function providerSelection(){return [...$('providers').querySelectorAll('input:checked')].map(x=>x.value);}
function getPrompts(){return [...new Set($('aiPrompts').value.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=320))].slice(0,20);}
function renderPromptEvidence(){
 const el=$('promptEvidence');if(!el)return;
 const byQuery=new Map((S.promptEvidence||[]).map(r=>[r.query,r]));
 const prompts=getPrompts();
 el.innerHTML=prompts.length?'<div class="tablewrap"><table><thead><tr><th>Запрос</th><th>Происхождение</th><th>Подтверждение</th></tr></thead><tbody>'+
 prompts.map(query=>{
   const e=byQuery.get(query);
   const status=e?(e.origin==='Точная формулировка SERP'?'Из поисковой выдачи':'Гипотеза на основе выдачи'):'Добавлен вручную — гипотеза';
   const details=e?clean(e.engine)+' · '+clean(e.sourceQuery)+(e.checkedAt?' · '+clean(new Date(e.checkedAt).toLocaleString('ru-RU')):' · дата не указана'):'До проверки в ИИ';
   return '<tr><td>'+clean(query)+'</td><td>'+status+'</td><td>'+details+'</td></tr>';
 }).join('')+'</tbody></table></div>':'<div class="hint">Нет запросов. Загрузите поисковый запуск.</div>';
}
function populateQuestions(){
 if(!S.seo)return;
 const opportunities=S.seo.rows.filter(r=>r.tested&&r.topPeers.some(p=>p.kind==='Возможная компания-конкурент'||p.confirmed));
 const ordered=[...opportunities,...S.seo.rows.filter(r=>r.tested&&!opportunities.includes(r))];
 // Do not synthesize a new buyer question and pretend it came from search results.
 // Each input retains the exact SERP query; rewritten natural-language variants are hypotheses.
 const seen=new Set();
 const evidence=ordered.filter(r=>{const key=r.query.toLowerCase().trim();if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,20);
 S.promptEvidence=evidence.map(r=>{
   const sourceQuery=r.query.trim();
   const alreadyNatural=/^(как|где|кто|какой|какая|какие|посоветуй|порекомендуй|что|сколько)\b/i.test(sourceQuery)&&sourceQuery.length>=12;
   const question=(alreadyNatural?sourceQuery:'Где можно найти '+sourceQuery+'?').slice(0,320);
   return {query:question,sourceQuery,origin:alreadyNatural?'Точная формулировка SERP':'Производная гипотеза из SERP',
     engine:r.engine,checkedAt:r.checkedAt||null,position:r.ownPosition,competitor:r.topPeers.find(p=>p.confirmed)?.domain||null};
 });
 $('aiPrompts').value=S.promptEvidence.map(r=>r.query).join('\n');
 renderPromptEvidence();
}
async function loadRun(){
 if(!$('run').value)return flash('Выберите поисковый запуск.','error');
 $('loadRun').disabled=true;
 try{
  const run=await post('geo-publisher',{action:'view',id:$('run').value});
  S.run=run;
  $('brand').value=run.input.brand||run.input.domain||'';
  $('competitorNames').value='';
  $('competitorDomains').value=(run.input.competitors||[]).join('; ');
  S.aiResults=[];S.audit=null;S.traffic=trafficSummary(null);S.promptEvidence=[];
  // Server-side view returns the full dated organic SERP sample, including our site.
  // A stale Publisher-only record cannot provide reliable comparative SEO positions.
  if(!Array.isArray(run.searchHits))throw Error('Этот запуск сохранён в старом формате без полной поисковой выдачи. Обновите GEO Publisher и повторите сбор данных.');
  S.seo=seoAnalysis({...run.input,competitors:getConfirmedDomains()},run.searchHits);
  populateQuestions();
  updateAI();
  $('report').classList.remove('hidden');
  $('readiness').classList.remove('hidden');
  $('readiness').textContent='Собрана поисковая выборка: '+S.seo.measured+' пар запрос × поисковик. История запуска: '+new Date(run.createdAt).toLocaleString('ru-RU')+'. Сайты из выдачи — кандидаты в конкуренты, а не проверенные юридические лица.';
  renderSEO();renderRivals();
  await loadAudit();
  renderAll();
  flash('Отчёт создан на основе сохранённых результатов поиска. Для ИИ-матрицы запустите отдельную проверку.','success');
 }catch(e){flash(e.message,'error');}
 finally{$('loadRun').disabled=false;}
}
async function loadAudit(){
 if(!S.run)return;
 try{S.audit=await post('site-audit',{url:S.run.input.url,brand:S.run.input.brand||''});}
 catch(e){S.audit=null;flash('Технический аудит недоступен: '+e.message+'; остальные разделы работают.','error');}
}
function renderSEO(){
 const rows=S.seo?.rows||[];
 $('seoTable').innerHTML=rows.length?'<div class="tablewrap"><table><thead><tr><th>Запрос / система</th><th>Наша позиция</th><th>Лучший подтверждённый конкурент</th><th>Сайтов в выдаче</th><th>Вывод</th></tr></thead><tbody>'+
 rows.map(r=>'<tr><td><strong>'+clean(r.query)+'</strong><div class="hint">'+clean(r.engine)+'</div></td>'+
 '<td>'+(!r.tested?'Нет данных':r.ownPosition==null?'Нет в выборке':'№'+r.ownPosition)+'</td>'+
 '<td>'+(r.confirmedCompetitorRank==null?'Пока не подтверждён':'№'+r.confirmedCompetitorRank)+'</td>'+
 '<td>'+r.returned+'</td><td>'+clean(r.opportunity)+'<div class="hint">'+clean(r.remark)+'</div></td></tr>').join('')+
 '</tbody></table></div>':'<div class="notice">Нет поисковых данных. Проведите подбор в GEO Publisher.</div>';
}
function renderRivals(){
 const rows=S.seo?.candidates||[];
 $('rivalTable').innerHTML=rows.length?'<div class="tablewrap"><table><thead><tr><th>Домен</th><th>Классификация</th><th>Запросов</th><th>Лучшая позиция</th><th>Подтверждение</th></tr></thead><tbody>'+
 rows.slice(0,50).map(r=>'<tr><td><a target="_blank" rel="noopener noreferrer" href="https://'+clean(r.domain)+'/">'+clean(r.domain)+'</a><div class="hint">'+clean(r.engines.join(', '))+'</div></td>'+
 '<td>'+clean(r.type)+'</td><td>'+r.queries.length+'</td><td>№'+r.bestPosition+'</td><td>'+
 (r.confirmed?'<span class="status ok">В списке конкурентов</span>':'<span class="status">Кандидат</span>')+'</td></tr>').join('')+
 '</tbody></table></div>':'<div class="notice">Конкурентные домены не обнаружены в собранной выдаче.</div>';
}
function renderAudit(){
 if(!S.audit){$('readiness').textContent='Технический аудит не получен. Проверьте доступность сайта в разделе «Аудит».';return;}
 const total=S.audit.geoScore==null?'Недостаточно данных':S.audit.geoScore+'/100';
 $('readiness').innerHTML='<strong>Техническая готовность к GEO: '+clean(total)+'</strong><div class="hint">Охват проверок: '+clean(S.audit.coveragePercent??'?')+
 '% · метод: '+clean(S.audit.evidence?.htmlMethod||'неизвестен')+'. Это техническая оценка, не вероятность рекомендаций ИИ.</div>'+
 '<div class="chips">'+(S.audit.geoGroups||[]).map(g=>'<span class="chip">'+clean(g.title)+': '+clean(g.points??'нет данных')+' / '+g.maxPoints+'</span>').join('')+'</div>';
}
function updateAI(){
 if(!S.run)return;
 const names=$('competitorNames').value.split(/[;\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,10);
 const prompts=getPrompts();
 S.ai=aiAnalysis({prompts,providers:providerSelection()},S.aiResults,$('brand').value,names);
}
function renderAI(){
 if(!S.ai){$('aiTable').textContent='Нет проверок.';return;}
 const rows=S.ai.matrix||[];
 const prov=providerSelection();
 if(!prov.length){$('aiTable').textContent='Нет выбранных ИИ-провайдеров.';return;}
 $('aiTable').innerHTML='<div class="chips"><span class="chip good">Отвечено с веб-поиском: '+S.ai.successfulWebAnswers+'</span>'+
 '<span class="chip">Упоминаний бренда: '+S.ai.brandMentions+'</span><span class="chip">Прямых ссылок: '+S.ai.ownCitations+'</span>'+
 '<span class="chip warn">Ошибок: '+S.ai.errors+'</span><span class="chip">Веб-поиск не подтверждён: '+S.ai.ungroundedAnswers+'</span></div>'+
 '<div class="tablewrap"><table><thead><tr><th>Вопрос клиента</th>'+prov.map(p=>'<th>'+clean(p)+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(row=>'<tr><td><strong>'+clean(row.prompt)+'</strong></td>'+row.items.map(x=>{
  const grounded=x.status==='Получен ответ'&&x.searchable===true&&x.mode!=='model-only';
  const style=x.status!=='Получен ответ'?'bad':grounded&&x.brand?'ok':'';
  const s=x.status==='Получен ответ'?(grounded?(x.brand?'Бренд назван':x.competitors.length?'Конкурент без бренда':'Без упоминания бренда'):'Ответ без подтверждённого веб-поиска'):x.status;
  const refs=x.sources?.length?'<div class="hint">'+x.sources.slice(0,2).map(z=>'<a target="_blank" rel="noopener noreferrer" href="'+clean(z.url)+'">Источник</a>').join(' · ')+'</div>':'';
  return '<td><span class="status '+style+'">'+clean(s)+'</span><div class="hint">'+clean(x.competitors.join(', '))+'</div>'+refs+'</td>';
 }).join('')+'</tr>').join('')+'</tbody></table></div>'+
 '<p class="hint">'+clean(S.ai.note)+'</p>';
}
function renderTraffic(){
 const t=S.traffic;
 if(!t?.rows?.length){$('trafficReport').textContent='Нет подтверждённой интеграции с Метрикой, GA4 или CRM. Нельзя оценить реальный поток клиентов по одному URL.';return;}
 $('trafficReport').innerHTML='<div class="chips"><span class="chip">Визитов: '+t.visits+'</span><span class="chip good">Обращений: '+t.leads+'</span><span class="chip">Период: '+clean(t.period||'не указан')+'</span></div>'+
 '<div class="tablewrap"><table><thead><tr><th>Источник</th><th>Визиты</th><th>Обращения</th><th>Конверсия</th></tr></thead><tbody>'+
 t.rows.map(r=>'<tr><td>'+clean(r.source)+'</td><td>'+r.visits+'</td><td>'+r.leads+'</td><td>'+(
 r.visits?Math.round(r.leads/r.visits*1000)/10+'%':'не рассчитывается')+'</td></tr>').join('')+'</tbody></table></div>'+
 '<p class="hint">'+clean(t.note)+' · Источник: '+clean(t.source)+' · загружено: '+clean(t.addedAt)+'</p>';
}
function renderActions(){
 const acts=priorityActions(S.seo,S.ai,S.audit,S.traffic);
 $('actionsReport').innerHTML=acts.map(x=>'<article class="action '+(x.priority==='Срочно'?'urgent':'')+'"><strong>'+clean(x.priority)+' · '+clean(x.area)+': '+clean(x.title)+'</strong>'+
 '<div>'+clean(x.detail)+'</div><small>Основание: '+clean(x.evidence)+'</small></article>').join('')||'<div class="muted">Действий пока нет.</div>';
 const aiCount=S.ai?.rivalOnlyQuestions?.length??0;
 $('clientSummary').innerHTML='<p><strong>Цель:</strong> увеличить заметность компании по релевантным запросам потенциальных клиентов, исправить технические ограничения сайта и развивать проверенные каналы привлечения.</p>'+
 '<p><strong>Измерено:</strong> '+S.seo.measured+' пар запрос × поисковик, '+S.seo.confirmedGaps+' подтверждённых SEO-разрывов, '+aiCount+' вопросов с явными конкурентными упоминаниями в результатах API.</p>'+
 '<p><strong>Пока неизвестно:</strong> реальное количество клиентов из поиска и ИИ без интеграций аналитики и CRM. Наличие в SEO не равно цитированию в нейросетях.</p>'+
 '<p><strong>Следующее действие:</strong> выполнить рекомендации по приоритетам, согласовать план GEO-публикаций и повторить измерение теми же запросами и методикой.</p>'+
 '<p class="hint">Дата формирования: '+new Date().toLocaleString('ru-RU')+'. Ответы ИИ зависят от провайдера, версии модели, даты и региона.</p>';
}
function renderAll(){
 if(!S.run)return;
 updateAI();renderAudit();renderAI();renderTraffic();renderActions();
 $('kQueries').textContent=S.seo.measured+'/'+S.seo.rows.length;
 $('kTop').textContent=S.seo.ownTop10;
 $('kRivals').textContent=S.seo.candidates.length;
 $('kGaps').textContent=S.seo.confirmedGaps;
 $('kAI').textContent=S.ai.successfulWebAnswers?S.ai.brandMentions+'/'+S.ai.successfulWebAnswers:'—';
}
async function runAI(){
 if(!S.run)return flash('Сначала загрузите поисковый запуск.','error');
 const prompts=getPrompts(),providers=providerSelection(),brand=$('brand').value.trim();
 if(brand.length<3)return flash('Укажите название компании для достоверной проверки.','error');
 if(!prompts.length||!providers.length)return flash('Нужны вопросы и хотя бы один подключённый ИИ.','error');
 if(prompts.length*providers.length>24)return flash('Первый запуск ограничен 24 запросами к API. Уменьшите список до 3–6 вопросов и 2–4 систем, затем расширяйте проверку.','error');
 if(S.busy)return;
 S.busy=true;S.stopped=false;$('runAI').disabled=true;$('stopAI').disabled=false;
 const names=$('competitorNames').value.split(/[;\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,10);
 let done=0;
 try{
  for(const prompt of prompts){
   for(const provider of providers){
    if(S.stopped)break;
    const key=prompt+'\u0000'+provider;
    if(S.aiResults.some(r=>r.prompt+'\u0000'+r.provider===key)){done++;continue;}
    $('aiProgress').textContent='Проверка '+(++done)+' / '+(prompts.length*providers.length)+' · '+provider;
    try{
     const data=await post('direct-geo',{action:'query',provider,prompt,brand,
      domain:S.run.input.domain,competitors:names});
     S.aiResults.push(data);
    }catch(e){S.aiResults.push({prompt,provider,error:e.message,checkedAt:new Date().toISOString()});}
    renderAll();
   }
   if(S.stopped)break;
  }
  flash(S.stopped?'Запуск остановлен. Полученные ответы сохранены в текущей вкладке.':'Проверка закончена. Проверьте ошибки провайдеров отдельно.','success');
 }finally{
  S.busy=false;$('runAI').disabled=false;$('stopAI').disabled=true;
  $('aiProgress').textContent='Получено ответов: '+S.ai.successfulWebAnswers+'; ошибок: '+S.ai.errors;
 }
}
function parseCSV(text){
 const lines=[];let record=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
  }else if(!quoted&&(ch===','||ch===';'||ch==='\t')){
   record.push(field);field='';
  }else if(!quoted&&(ch==='\r'||ch==='\n')){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   record.push(field);if(record.some(Boolean))lines.push(record);record=[];field='';
  }else field+=ch;
 }
 if(quoted)throw Error('Ошибка кавычек в CSV');
 record.push(field);if(record.some(Boolean))lines.push(record);
 return lines;
}
function importTraffic(){
 try{
  const rows=parseCSV($('trafficCsv').value.trim());
  if(rows.length<2||rows.length>61)throw Error('Выгрузка должна содержать заголовки и 1–60 строк.');
  const header=rows.shift().map(s=>s.trim().toLowerCase().replace(/^\ufeff/,''));
  if(header.join(',')!=='source,visits,leads')throw Error('Ожидается заголовок source,visits,leads');
  const cleaned=rows.map(r=>{
   const visits=Number(r[1]),leads=Number(r[2]);
   if(r.length!==3||!r[0]?.trim()||!Number.isInteger(visits)||!Number.isInteger(leads)||
     visits<0||leads<0||visits>100000000||leads>100000000)throw Error('Неверный формат строк. Только целые неотрицательные значения.');
   return {source:r[0].trim().slice(0,120),visits,leads};
  });
  S.traffic=trafficSummary({source:'CSV, предоставленный пользователем',period:$('period').value.trim(),
   addedAt:new Date().toISOString(),rows:cleaned});
  renderAll();flash('Выгрузка применена как данные клиента. Показатели не подтверждены прямым API.','success');
 }catch(e){flash(e.message,'error');}
}
function downloadJSON(){
 const packet={meta:{createdAt:new Date().toISOString(),source:'MIRVIX Intelligence',notice:'Данные AI API не равны выдаче пользовательских приложений'},
 run:{id:S.run.id,input:S.run.input,createdAt:S.run.createdAt},
 seo:S.seo,searchEvidence:S.run.searchHits,queryProvenance:S.promptEvidence,technicalAudit:S.audit,ai:S.ai,aiResults:S.aiResults,
 traffic:S.traffic,actions:priorityActions(S.seo,S.ai,S.audit,S.traffic)};
 const blob=new Blob([JSON.stringify(packet,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mirvix-intelligence-'+S.run.id.slice(0,8)+'.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('loadRun').addEventListener('click',loadRun);
$('discover').addEventListener('click',()=>{populateQuestions();renderAll();flash('Матрица содержит исходные наблюдаемые SEO-запросы; новые варианты нужно проверять отдельно.','success');});
$('runAI').addEventListener('click',runAI);
$('stopAI').addEventListener('click',()=>{S.stopped=true;$('aiProgress').textContent='Останавливаем после текущего запроса…';});
$('loadTraffic').addEventListener('click',importTraffic);
$('clearTraffic').addEventListener('click',()=>{$('trafficCsv').value='';S.traffic=trafficSummary(null);renderAll();});
$('print').addEventListener('click',()=>window.print());
$('exportJson').addEventListener('click',downloadJSON);
$('competitorNames').addEventListener('change',renderAll);
$('competitorDomains').addEventListener('change',recalcCompetitors);
$('aiPrompts').addEventListener('change',()=>{renderPromptEvidence();renderAll();});
$('providers').addEventListener('change',renderAll);
boot();