const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {id:null, report:null, active:null, busy:false, configured:false};
const API='/ .netlify/functions/geo-publisher'.replace('/ ','/');
const setNotice=(message,type='')=>{
  $('resultNotice').innerHTML=message?'<div class="notice '+safe(type)+'">'+safe(message)+'</div>':'';
};
async function api(action,rest={}){
  const res=await fetch(API,{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Mirvix-Cabinet':'1'},
    body:JSON.stringify({action,...rest})});
  if(!res.ok){
    const body=await res.json().catch(()=>({}));
    throw Error(body.error || 'Сервер вернул HTTP '+res.status);
  }
  return await res.json();
}
async function verify(){
  try{
    const auth=await fetch('/.netlify/functions/cabinet-auth',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Mirvix-Cabinet':'1'},body:JSON.stringify({action:'status'})});
    const data=await auth.json();
    if(data.role!=='staff'){
      $('authNotice').innerHTML='Для доступа необходимо <a href="/cabinet/">войти в кабинет сотрудника</a>. Партнёрский доступ не открывает базу клиентов.';
      return;
    }
    $('authNotice').classList.add('hidden');
    $('app').classList.remove('hidden');
    const status=await api('status');
    state.configured=status.configured;
    $('apiStatus').textContent=status.configured?'SERP API подключён':'Нет ключа SERP API';
    $('apiStatus').className='tag '+(status.configured?'good':'warn');
    if(!status.configured) setNotice('Для живого поиска необходимо добавить MIRVIX_SERPAPI_KEY в Netlify. Поиск без реальных данных не запускается.');
    await listRuns();
  }catch(e){$('authNotice').textContent='Ошибка проверки доступа: '+e.message;}
}
async function listRuns(){
  try{
    const data=await api('list');
    const select=$('runSelector'),old=state.id||select.value;
    select.replaceChildren(new Option('Выберите сохранённый запуск',''));
    for(const r of data.runs||[]){
      select.add(new Option(new Date(r.createdAt).toLocaleString('ru-RU')+' · '+(r.brand||r.domain)+' · '+r.region,r.id));
    }
    if(old && [...select.options].some(x=>x.value===old))select.value=old;
  }catch(e){setNotice(e.message,'error');}
}
function getInput(){
  return {
    url:$('site').value, brand:$('brand').value, region:$('region').value,
    queries:$('queries').value, search:$('search').value,
    lr:$('lr').value, gl:$('gl').value, max:Number($('max').value),
    budget:$('budget').value, audience:$('audience').value,
    competitors:$('competitors').value,exclusions:$('exclusions').value
  };
}
$('pilotMirvix').addEventListener('click',()=>{
  $('site').value='https://mirvixai.com/';
  $('brand').value='MIRVIX AI';
  $('region').value='Санкт-Петербург, Россия';
  $('search').value='both';
  $('lr').value='2';
  $('gl').value='ru';
  $('max').value='30';
  $('queries').value=[
    'продвижение компании в нейросетях',
    'GEO продвижение бизнеса',
    'как повысить видимость бренда в ChatGPT'
  ].join('\n');
  $('audience').value='Владельцы и руководители малого и среднего бизнеса';
  $('competitors').value='';
  $('exclusions').value='';
  $('budget').value='';
  setNotice('Пилот MIRVIX AI заполнен. Данные не отправлены в поиск. Для запуска нужен подключённый SERP API.','good');
});
$('launchForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!state.configured){setNotice('Сначала подключите MIRVIX_SERPAPI_KEY в настройках Netlify.','error');return;}
  if(state.busy)return;
  state.busy=true;$('launch').disabled=true;
  try{
    const created=await api('start',{input:getInput()});
    state.id=created.id;state.active=null;
    await listRuns();await refreshReport();
    await processSteps();
  }catch(e){setNotice(e.message,'error');}
  finally{state.busy=false;$('launch').disabled=false;}
});
async function openSaved(){
  const id=$('runSelector').value;
  if(!id)return setNotice('Выберите запуск.','error');
  state.id=id;state.active=null;
  try{await refreshReport();setNotice('История запуска загружена.');}
  catch(e){setNotice(e.message,'error');}
}
$('openRun').addEventListener('click',openSaved);
$('refreshRuns').addEventListener('click',listRuns);
$('resumeRun').addEventListener('click',async()=>{
  if(state.busy)return;
  state.busy=true;
  try{await processSteps();}finally{state.busy=false;}
});
async function processSteps(){
  if(!state.id)return;
  $('resumeRun').disabled=true;
  setNotice('');
  let report=await api('view',{id:state.id});
  const stages=report.stages||[];
  const errors=[];
  for(let idx=0;idx<stages.length;idx++){
    if(stages[idx].status==='done')continue;
    $('runStatus').textContent='Поиск '+(idx+1)+' из '+stages.length+': '+stages[idx].engine+' — '+stages[idx].query;
    try{
      const result=await api('step',{id:state.id,index:idx});
      if(result.error){errors.push(stages[idx].engine+': '+result.error);if(/ключ|api|лимит|limit|429|401|403/i.test(result.error))break;}
    }catch(e){errors.push(e.message);break;}
    await refreshReport();
  }
  await refreshReport();
  $('resumeRun').disabled=false;
  $('runStatus').textContent='Поисковые этапы: '+state.report.completed+' / '+state.report.total;
  if(errors.length)setNotice('Часть поисков не выполнена: '+errors.slice(0,3).join(' | '),'error');
  else setNotice('Данные сохранены. Можно оценивать площадки, составлять ТЗ и экспортировать результаты.','good');
}
async function refreshReport(){
  const report=await api('view',{id:state.id});
  state.report=report;
  $('resultsSection').classList.remove('hidden');
  $('progressWrap').classList.remove('hidden');
  $('progressBar').style.width= (report.total?Math.round(report.completed/report.total*100):0)+'%';
  $('progressLabel').textContent='Готово '+report.completed+' / '+report.total+' поисковых запросов; '+report.stages.filter(x=>x.status==='error').length+' ошибок. Используется реально полученная органическая выдача.';
  $('resumeRun').disabled=state.busy||report.completed===report.total;
  $('nPlatforms').textContent=report.summary.domains;
  $('nHits').textContent=report.summary.hits;
  $('nConfirmed').textContent=report.summary.confirmed;
  $('nHigh').textContent=report.summary.high;
  $('nPublished').textContent=report.summary.published;
  drawRows();
  if(state.active){const current=report.platforms.find(x=>x.domain===state.active);if(current)drawDetail(current);else $('detail').classList.add('hidden');}
}
function drawRows(){
  const term=$('filter').value.trim().toLocaleLowerCase('ru-RU');
  const rows=(state.report?.platforms||[]).filter(p=>!term|| (p.domain+' '+p.type+' '+p.workStatus).toLocaleLowerCase('ru-RU').includes(term));
  $('rows').innerHTML=rows.length?rows.map((p)=>{
    const links=(p.matches||[]).slice(0,2).map(m=>'<div><a href="'+safe(m.url)+'" target="_blank" rel="noopener noreferrer">'+safe(m.engine)+' · '+safe(m.query)+'</a><span class="small"> #'+safe(m.position)+'</span></div>').join('');
    const rating=p.score===null?'Недостаточно данных':p.score+'/100';
    const level=p.publication?.status==='confirmed'?'good':p.publication?.status==='unavailable'?'warn':'dim';
    const pub=p.publication?.status==='confirmed'?'Подтверждена':p.publication?.status==='unavailable'?'Недоступна':'Не проверена';
    return '<tr><td><div class="domain">'+safe(p.domain)+'</div><div class="meta">'+safe(p.type)+'</div></td>'+
      '<td>'+links+'<div class="meta">'+p.matches.length+' результатов</div></td>'+
      '<td><strong>'+safe(rating)+'</strong><div class="meter"><span style="width:'+p.scoreMin+'%"></span></div><div class="meta">'+safe(p.priority)+' · уверенность: '+safe(p.coverage)+'%</div></td>'+
      '<td><span class="tag '+level+'">'+safe(pub)+'</span><div class="meta">'+(p.price===null?'Цена неизвестна':safe(p.price)+' ₽')+'</div></td>'+
      '<td><span class="small">'+safe(p.workStatus)+'</span></td><td><button data-domain="'+safe(p.domain)+'" class="secondary view">Открыть</button></td></tr>';
  }).join(''):'<tr><td colspan="6" class="empty">Площадок пока нет. Запустите реальный поиск или измените фильтр.</td></tr>';
}
$('filter').addEventListener('input',drawRows);
$('rows').addEventListener('click',(event)=>{
  const button=event.target.closest('button[data-domain]');
  if(!button)return;
  const p=state.report.platforms.find(p=>p.domain===button.dataset.domain);
  if(p){state.active=p.domain;drawDetail(p);$('detail').scrollIntoView({behavior:'smooth',block:'start'});}
});
function drawDetail(p){
  const matches=(p.matches||[]).map(m=>'<p>'+safe(m.engine)+' · №'+safe(m.position)+
    ' · <a href="'+safe(m.url)+'" target="_blank" rel="noopener noreferrer">'+safe(m.title||m.url)+'</a> ('+safe(m.query)+')</p>').join('');
  const options=(items,selected)=>items.map(v=>'<option value="'+safe(v)+'"'+(v===selected?' selected':'')+'>'+safe(v)+'</option>').join('');
  const statuses=['Новая рекомендация','На проверке','Подходит для размещения','Не подходит','Связались с площадкой','Ожидаем ответа','Получен отказ','Согласовано размещение','Материал готовится','Материал отправлен','Опубликовано'];
  $('detail').innerHTML='<div class="toolbar"><div><h3>'+safe(p.domain)+'</h3><div class="small">'+safe(p.type)+' · '+safe(p.priority)+' · рейтинг: '+(p.score==null?'недостаточно подтверждений':p.score+'/100')+'</div></div><button class="ghost" id="closeDetail">Закрыть</button></div>'+
    '<div class="notice">Диапазон с учётом неизвестных критериев: '+safe(p.scoreMin)+'–'+safe(p.scoreMax)+'. Охват оценки: '+safe(p.coverage)+'%. Поисковые позиции подтверждены API, но право публикации и редакционные условия требуют отдельного подтверждения.</div>'+
    '<h4>Найденные страницы и позиции</h4><div class="source-list">'+matches+'</div>'+
    '<div class="actions"><button class="secondary" id="inspectSite">Найти контакты и условия редакции</button></div>'+
    '<div id="inspectCandidates">'+(p.candidates?.length?'<h4>Найденные страницы редакции (не подтверждение условий)</h4><div class="source-list">'+p.candidates.map(x=>'<p><a target="_blank" rel="noopener noreferrer" href="'+safe(x.url)+'">'+safe(x.title||x.url)+'</a> · '+safe(x.excerpt)+'</p>').join('')+'</div>':'')+'</div>'+
    '<div class="details-grid">'+
    '<label>Рабочий статус<select id="dStatus">'+options(statuses,p.workStatus)+'</select></label>'+
    '<label>Доступность размещения<select id="dPub">'+options(['unknown','confirmed','unavailable'],p.publication?.status||'unknown')+'</select></label>'+
    '<label>Стоимость, ₽<input id="dPrice" type="number" min="0" value="'+safe(p.price??'')+'" placeholder="Неизвестна"></label>'+
    '<label class="span2">Источник подтверждения условий (HTTPS)<input id="dSource" value="'+safe(p.publication?.source||'')+'" placeholder="https://example.com/advertising"></label>'+
    '<label>Качество / репутация, 0–100<input id="dQuality" type="number" min="0" max="100" value="'+safe(p.quality??'')+'" placeholder="Не оценено"></label>'+
    '<label class="span3">Условия публикации (только подтверждённые)<textarea id="dConditions">'+safe(p.publication?.conditions||'')+'</textarea></label>'+
    '<label>Соответствие аудитории и региону, 0–100<input id="dGeo" type="number" min="0" max="100" value="'+safe(p.geographyEvidence??'')+'" placeholder="Не подтверждено"></label>'+
    '<label class="span2">Контакты редакции (через запятую)<input id="dContacts" value="'+safe((p.contacts||[]).join(', '))+'"></label>'+
    '<label class="span3">Тема материала<input id="dTopic" value="'+safe(p.suggestedTopic||'')+'"></label>'+
    '<label class="span3">Комментарий специалиста / причина отказа<textarea id="dNotes">'+safe(p.notes||'')+'</textarea></label>'+
    '<label class="span3">Ссылка на опубликованную статью (HTTPS)<input id="dPublished" value="'+safe(p.publishedUrl||'')+'" placeholder="https://..."></label>'+
    '</div><div class="actions"><button id="saveDetail">Сохранить сведения</button><button class="secondary" id="copyBrief">Скопировать ТЗ</button><button class="ghost" id="downloadBrief">Скачать ТЗ (.txt)</button></div>'+
    '<h4>Техническое задание для статьи</h4><div class="small">ТЗ сформировано из кластера и данных площадки; редактор согласует факты перед публикацией.</div>'+
    '<pre class="brief" id="briefText">'+safe(p.brief)+'</pre>';
  $('detail').classList.remove('hidden');
  $('closeDetail').addEventListener('click',()=>{state.active=null;$('detail').classList.add('hidden');});
  $('saveDetail').addEventListener('click',saveDetail);
  $('inspectSite').addEventListener('click',async()=>{
    $('inspectSite').disabled=true;
    try{
      const result=await api('inspect',{id:state.id,domain:p.domain});
      const rows=result.candidates||[];
      $('inspectCandidates').innerHTML=rows.length?'<h4>Найденные страницы редакции (проверить вручную)</h4><div class="source-list">'+rows.map(x=>'<p><a target="_blank" rel="noopener noreferrer" href="'+safe(x.url)+'">'+safe(x.title||x.url)+'</a> · '+safe(x.excerpt)+'</p>').join('')+'</div>':'<div class="notice">На стандартных адресах редакционных условий не найдено. Это не означает, что публикация невозможна.</div>';
      setNotice(result.notice,'good');
    }catch(e){setNotice(e.message,'error');}
    finally{$('inspectSite').disabled=false;}
  });
  $('copyBrief').addEventListener('click',async()=>{await navigator.clipboard.writeText(p.brief);setNotice('ТЗ скопировано.','good');});
  $('downloadBrief').addEventListener('click',()=>download(new Blob([p.brief],{type:'text/plain;charset=utf-8'}),'mirvix-brief-'+p.domain+'.txt'));
}
function optionalInt(id){const s=$(id).value.trim();return s===''?null:Number(s);}
async function saveDetail(){
  const publication={status:$('dPub').value,source:$('dSource').value.trim(),
    conditions:$('dConditions').value.trim()};
  if(publication.status==='confirmed' && (!publication.source||!publication.conditions)){
    setNotice('Для статуса «Подтверждена» необходимы ссылка-источник и условия размещения.','error');return;
  }
  try{
    await api('edit',{id:state.id,domain:state.active,
      workStatus:$('dStatus').value,publication,price:optionalInt('dPrice'),
      quality:optionalInt('dQuality'),geographyEvidence:optionalInt('dGeo'),
      contacts:$('dContacts').value,suggestedTopic:$('dTopic').value,
      notes:$('dNotes').value,publishedUrl:$('dPublished').value});
    await refreshReport();setNotice('Данные сохранены в общей базе площадок и истории клиента.','good');
  }catch(e){setNotice(e.message,'error');}
}
$('siteAudit').addEventListener('click',async()=>{
  if(!state.id)return;
  $('siteAudit').disabled=true;
  try{
    const r=await api('audit',{id:state.id});
    const p=r.profile;
    $('profile').innerHTML='<strong>Профиль клиента (по публичным данным)</strong><p>Бренд: '+safe(p.brand)+' · '+safe(p.domain)+'</p><p>Название: '+safe(p.title)+'</p><p>Описание: '+safe(p.description)+'</p><p>Подтверждённые разделы: '+safe((p.serviceHeadings||[]).join(', '))+'</p><p class="small">'+safe(r.note)+'</p>';
    $('profile').classList.remove('hidden');
  }catch(e){setNotice('Не удалось проанализировать сайт: '+e.message,'error');}
  finally{$('siteAudit').disabled=false;}
});
function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function exportData(format){
  if(!state.id)return;
  try{
    const response=await fetch(API,{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Mirvix-Cabinet':'1'},
      body:JSON.stringify({action:'export',id:state.id,format})});
    if(!response.ok)throw Error((await response.json()).error||'Ошибка экспорта');
    download(await response.blob(),'mirvix-geo-'+state.id.slice(0,8)+'.'+format);
  }catch(e){setNotice(e.message,'error');}
}
$('exportXlsx').addEventListener('click',()=>exportData('xlsx'));
$('exportCsv').addEventListener('click',()=>exportData('csv'));
verify();