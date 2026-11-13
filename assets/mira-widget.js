(() => {
'use strict';
const root=document.getElementById('mira-widget');if(!root)return;
const by=name=>root.querySelector('[data-mira="'+name+'"]');
const ui={
 launch:by('launch'),dialog:by('dialog'),close:by('close'),history:by('history'),
 input:by('input'),send:by('send'),mic:by('mic'),voicecheck:by('voicecheck'),
 transcript:by('transcript'),confirm:by('confirm'),retry:by('retry'),cancel:by('cancel'),
 consentPanel:by('ai-consent-panel'),aiYes:by('ai-yes'),aiNo:by('ai-no'),settings:by('privacy-settings'),
 delivery:by('delivery-panel'),deliveryOpen:by('delivery-open'),deliveryClose:by('close-lead'),
 deliverySend:by('send-lead'),deliveryConsent:by('delivery-consent'),
 leadName:by('lead-name'),leadContact:by('lead-contact'),leadStatus:by('lead-status')
};
if(Object.values(ui).some(x=>!x))return;
const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
const SETTINGS_KEY='mirvix-mira-ai-choice-v1';
const CONTACT=/(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;
const links=[
 {pattern:/тариф|стоимост|цен[ауые]|рубл|сколько стоит|пакет/i,label:'Смотреть тарифы GEO-продвижения',url:'/tariffs/'},
 {pattern:/сопровожд|поддержк|ведение|обновлени[яй] сайта/i,label:'Условия сопровождения',url:'/tariffs/#support'},
 {pattern:/контакт|связат|телефон|почт|адрес|мессенджер|написать вам/i,label:'Контакты MIRVIX AI',url:'/legal/contacts/'},
 {pattern:/услуг|разработк|внедр|ассистент|бот/i,label:'Услуги MIRVIX AI',url:'/#services'},
 {pattern:/провер|аудит|готовност|сайт.*ии/i,label:'Бесплатная проверка сайта',url:'/check/'},
 {pattern:/инструмент|конкурент|матриц|сравнен/i,label:'Инструменты MIRVIX AI',url:'/tools/'}
];
const allowedRoutes=new Set(['/tariffs/','/tariffs/#support','/legal/contacts/','/#services','/check/','/tools/']);
const state={consent:null,loading:false,rec:null,pending:'',messages:[],lastReply:'',requestId:null,voiceBusy:false};
function loadConsent(){
 try{const v=window.localStorage.getItem(SETTINGS_KEY);return v==='yes'||v==='no'?v:null;}catch{return null;}
}
function saveConsent(value){state.consent=value;try{window.localStorage.setItem(SETTINGS_KEY,value);}catch{}updateConsent();}
function updateConsent(){ui.consentPanel.hidden=state.consent!==null;ui.settings.setAttribute('aria-label','Изменить согласие на использование ИИ');}
function addBubble(text,own=false,context=''){
 const el=document.createElement('div');el.className='mira-bubble'+(own?' mine':'');
 const p=document.createElement('div');p.textContent=String(text||'');el.appendChild(p);
 if(!own){
  const matches=links.filter(l=>l.pattern.test(context||'')).slice(0,2);
  for(const item of matches){
   if(!allowedRoutes.has(item.url))continue;
   const a=document.createElement('a');a.href=item.url;a.textContent=item.label;
   a.className='mira-site-link';a.rel='noopener';el.appendChild(a);
  }
 }
 ui.history.appendChild(el);ui.history.scrollTop=ui.history.scrollHeight;return el;
}
function status(text){addBubble(text);}
const uuid=()=>typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():
 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,12);
function localAnswer(q){
 if(/тариф|цена|сколько стоит|стоимост|пакет/i.test(q))
  return 'GEO-продвижение в ИИ-поиске: Старт — 50 000 ₽ (2 запроса), Оптимум — 89 000 ₽ (10), Бизнес — 129 000 ₽ (20), Максимум — 259 000 ₽ (30). Условия и состав работ — на странице тарифов.';
 if(/сопровожд|ведение/i.test(q))
  return 'Сопровождение после первоначального GEO-проекта — по выбору: 45 000, 65 000 или 85 000 ₽ в месяц. Можно вести сайт и самостоятельно.';
 if(/контакт|связат|телефон|почт|адрес/i.test(q))
  return 'Актуальные контакты MIRVIX AI собраны на странице контактов. Для передачи задачи с контактами нажмите значок письма под перепиской.';
 if(/услуг|разработк|внедр|ассистент|бот/i.test(q))
  return 'MIRVIX AI занимается продвижением бизнеса в нейросетях и ИИ-поиске, подготовкой сайтов для ИИ и внедрением помощников для обработки обращений. Уточните, какой у вас бизнес и какую задачу хотите решить.';
 if(/провер|аудит|готовност/i.test(q))
  return 'Начать можно с бесплатной проверки технической готовности сайта, затем выбрать покупательские запросы и оценить присутствие в нейросетях. Ссылку на проверку прикрепила ниже.';
 return 'Могу помочь разобраться в GEO-продвижении, тарифах, работе сайта и ИИ-помощниках. Подробности можно уточнить у специалиста через кнопку передачи обращения.';
}
function setBusy(x){
 state.loading=x;ui.send.disabled=x;ui.input.disabled=x;ui.mic.disabled=x||state.voiceBusy;
 ui.deliverySend.disabled=x;
}
async function sendMessage(initial){
 const text=String(initial||'').trim();if(!text||state.loading)return;
 if(text.length>1600){status('Сократите сообщение до 1600 символов.');return;}
 if(state.consent===null){state.pending=text;ui.consentPanel.hidden=false;return;}
 ui.input.value='';addBubble(text,true);
 if(CONTACT.test(text)){
  status('Пожалуйста, не отправляйте личные контакты в ИИ-диалог. Для передачи их специалисту откройте форму по значку письма ✉.');return;
 }
 state.messages.push({role:'user',content:text});state.messages=state.messages.slice(-12);
 if(state.consent==='no'){
  const response=localAnswer(text);addBubble(response,false,text);state.lastReply=response;return;
 }
 setBusy(true);
 try{
  const response=await fetch('/api/mira-chat',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({consent:true,messages:state.messages}),credentials:'same-origin'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.reply!=='string'||!data.reply.trim())throw Error('Сервис пока недоступен');
  let answer=data.reply.trim();
  if(answer===state.lastReply)answer='Уточните, какая часть ответа вам важнее: условия работы, стоимость или следующий шаг?';
  state.lastReply=answer;state.messages.push({role:'assistant',content:answer});
  state.messages=state.messages.slice(-12);addBubble(answer,false,text);
 }catch{
  const answer=localAnswer(text);
  addBubble('Свободный ИИ-диалог сейчас недоступен. '+answer,false,text);
 }finally{setBusy(false);}
}
function submitPending(){
 const text=state.pending;state.pending='';
 if(text)void sendMessage(text);
}
function open(){
 ui.dialog.hidden=false;ui.launch.setAttribute('aria-expanded','true');document.body.classList.add('mira-chat-open');
 updateConsent();ui.input.focus();
}
function hide(){
 ui.dialog.hidden=true;ui.launch.setAttribute('aria-expanded','false');document.body.classList.remove('mira-chat-open');
 if(state.rec){try{state.rec.abort();}catch{}}
 ui.launch.focus();
}
function setDelivery(open){
 ui.delivery.hidden=!open;
 if(open){ui.leadStatus.textContent='';ui.deliveryConsent.checked=false;ui.leadContact.focus();}
}
async function sendLead(){
 if(state.loading)return;
 const name=ui.leadName.value.trim(),contact=ui.leadContact.value.trim();
 if(name.length<2||contact.length<5){ui.leadStatus.textContent='Укажите имя и рабочий способ связи.';return;}
 if(!ui.deliveryConsent.checked){ui.leadStatus.textContent='Для передачи контактов подтвердите отдельное согласие.';return;}
 if(!state.messages.some(m=>m.role==='user')){ui.leadStatus.textContent='Сначала расскажите МИРЕ о задаче.';return;}
 state.requestId=state.requestId||uuid();setBusy(true);ui.leadStatus.textContent='Сохраняем обращение…';
 const task=state.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n').slice(0,1900);
 try{
  const res=await fetch('/api/mira-submit',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name,contact,original:task,task,consent:true,requestId:state.requestId}),credentials:'same-origin'});
  const info=await res.json().catch(()=>({}));
  if(!res.ok||info.saved!==true)throw Error(info.error||'Не получили подтверждение сохранения.');
  ui.leadStatus.textContent=info.notification==='sent'?
   'Заявка №'+info.id+' сохранена и передана специалистам.':
   'Заявка №'+info.id+' сохранена. Уведомление ожидает доставки.';
  status(ui.leadStatus.textContent);state.requestId=null;setDelivery(false);
 }catch(err){ui.leadStatus.textContent='Не удалось подтвердить сохранение. '+(err?.message||'Повторите отправку.');}
 finally{setBusy(false);}
}
const SpeechAvailable=!!Speech;
function voiceStart(){
 if(!SpeechAvailable){status('В этом мобильном браузере распознавание речи недоступно. Можно написать сообщение с клавиатуры.');return;}
 if(state.rec){try{state.rec.stop();}catch{}return;}
 let rec;try{rec=new Speech();}catch{status('Браузер не разрешает запуск распознавания.');return;}
 state.rec=rec;state.voiceBusy=true;
 rec.lang='ru-RU';rec.interimResults=false;rec.continuous=false;rec.maxAlternatives=1;
 ui.mic.setAttribute('aria-label','Остановить запись');ui.mic.classList.add('mira-listening');
 rec.onresult=e=>{
  const result=e.results?.[0]?.[0]?.transcript||'';
  if(result.trim()){ui.transcript.value=result.trim();ui.voicecheck.hidden=false;setBusy(false);}
 };
 rec.onerror=e=>{
  const reason={not_allowed:'Нет разрешения на микрофон', 'not-allowed':'Нет разрешения на микрофон',
   'service-not-allowed':'Сервис распознавания недоступен',network:'Ошибка сети при распознавании',
   'no-speech':'Речь не обнаружена','audio-capture':'Микрофон недоступен'}[e.error]||'Ошибка распознавания';
  status(reason+'. Разрешите микрофон в настройках браузера или напишите сообщение.');
 };
 rec.onend=()=>{state.rec=null;state.voiceBusy=false;ui.mic.setAttribute('aria-label','Надиктовать сообщение');
  ui.mic.classList.remove('mira-listening');setBusy(false);};
 try{rec.start();}catch{state.rec=null;state.voiceBusy=false;status('Не удалось запустить микрофон. Проверьте разрешения браузера.');setBusy(false);}
}
const mobile=window.matchMedia?.('(max-width:960px)');
const head=document.querySelector('.site-header .header-inner');
function dock(){
 const toHeader=!!mobile?.matches&&!!head,dest=toHeader?head:root;
 if(ui.launch.parentElement===dest)return;
 if(toHeader){const toggle=head.querySelector('.mobile-toggle');if(toggle)head.insertBefore(ui.launch,toggle);else head.appendChild(ui.launch);}
 else dest.insertBefore(ui.launch,dest.firstChild);
}
dock();mobile?.addEventListener?.('change',dock);
state.consent=loadConsent();updateConsent();
ui.launch.addEventListener('click',()=>ui.dialog.hidden?open():hide());
ui.close.addEventListener('click',hide);
ui.send.addEventListener('click',()=>void sendMessage(ui.input.value));
ui.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage(ui.input.value);}});
ui.aiYes.addEventListener('click',()=>{saveConsent('yes');submitPending();});
ui.aiNo.addEventListener('click',()=>{saveConsent('no');submitPending();});
ui.settings.addEventListener('click',()=>{state.consent=null;ui.consentPanel.hidden=false;ui.input.focus();});
ui.deliveryOpen.addEventListener('click',()=>setDelivery(!ui.delivery.hidden));
ui.deliveryClose.addEventListener('click',()=>setDelivery(false));
ui.deliverySend.addEventListener('click',()=>void sendLead());
ui.mic.addEventListener('click',voiceStart);
ui.confirm.addEventListener('click',()=>{const text=ui.transcript.value.trim();ui.voicecheck.hidden=true;
 ui.transcript.value='';if(text)void sendMessage(text);});
ui.retry.addEventListener('click',()=>{ui.voicecheck.hidden=true;ui.transcript.value='';voiceStart();});
ui.cancel.addEventListener('click',()=>{ui.voicecheck.hidden=true;ui.transcript.value='';});
if(!SpeechAvailable){ui.mic.title='Голосовой ввод недоступен в этом браузере';ui.mic.setAttribute('aria-label',ui.mic.title);}
})();