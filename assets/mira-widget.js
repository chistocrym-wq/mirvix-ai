(() => {
'use strict';
const root=document.getElementById('mira-widget');if(!root)return;
const el=(name)=>root.querySelector('[data-mira="'+name+'"]');
const launch=el('launch'),dialog=el('dialog'),close=el('close'),history=el('history'),input=el('input'),send=el('send'),mic=el('mic'),check=el('voicecheck'),transcript=el('transcript');
let step='task',caseData={task:'',detail:'',name:'',contact:''},recognition=null,recPending=false;
const add=(text,mine=false)=>{const p=document.createElement('div');p.className='mira-bubble'+(mine?' mine':'');p.textContent=text;history.appendChild(p);history.scrollTop=history.scrollHeight;};
const say=(text)=>add(text);
function escapeMail(value){return String(value||'').trim();}
function reset(){step='task';caseData={task:'',detail:'',name:'',contact:''};history.replaceChildren();say('Здравствуйте! Я MIRA. Расскажите, что вам нужно: можете написать или надиктовать сообщение. Я выслушаю, уточню детали и помогу передать обращение специалисту.');const choices=document.createElement('div');choices.className='mira-quick';['Нужен помощник для клиентов','Нужна автоматизация','Хочу улучшить видимость в поиске'].forEach(t=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.addEventListener('click',()=>accept(t));choices.appendChild(b)});history.appendChild(choices);}
function summary(){return 'Проверьте обращение:\nЗадача: '+caseData.task+'\nДополнительно: '+(caseData.detail||'Не указано')+'\nИмя: '+caseData.name+'\nКонтакт: '+caseData.contact+'\n\nВсё верно?';}
function actions(items){const bar=document.createElement('div');bar.className='mira-quick';items.forEach(([label,action])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);bar.appendChild(b)});history.appendChild(bar);history.scrollTop=history.scrollHeight;}
function mail(){const subject='Обращение через MIRA | MIRVIX AI';const body=['Здравствуйте!','',summary().replace('Проверьте обращение:\n','').replace('\n\nВсё верно?',''),'', 'Я подтверждаю отправку этого обращения и прошу связаться со мной.'].join('\n');window.location.href='mailto:mirvixai@mail.ru?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);say('Откроется почтовое приложение с готовым письмом. Для передачи обращения специалисту нажмите в нём «Отправить». Я не отправляю сообщение автоматически.');}
function accept(value){const t=String(value||'').trim().slice(0,2500);if(!t)return;add(t,true);input.value='';
switch(step){
case 'task':caseData.task=t;step='detail';say('Поняла. Где это должно работать и что именно нужно делать? Например: сайт, мессенджеры, заявки, CRM, запись клиентов. Если подробностей пока нет, напишите «пока не знаю».');break;
case 'detail':caseData.detail=t;step='name';say('Спасибо! Как к вам обращаться?');break;
case 'name':caseData.name=t;step='contact';say('Оставьте удобный контакт для ответа: телефон, электронную почту или Telegram. Эти данные нужны только для связи по вашему обращению.');break;
case 'contact':caseData.contact=t;step='review';say(summary());actions([['Да, всё верно',()=>{step='done';say('Отлично! Я подготовлю письмо специалисту MIRVIX AI.');actions([['Открыть письмо для отправки',mail],['Начать заново',reset]])}],['Исправить',()=>{step='task';caseData={task:'',detail:'',name:'',contact:''};say('Хорошо, расскажите задачу заново — я запишу исправленный вариант.')}]]);break;
case 'review':if(/да|верно|подтверждаю/i.test(t)){step='done';say('Отлично. Нажмите кнопку ниже, чтобы открыть письмо.');actions([['Открыть письмо для отправки',mail]])}else{step='task';caseData={task:'',detail:'',name:'',contact:''};say('Начнём сначала. Расскажите, что исправить в задаче.')}break;
case 'done':say('Если хотите оставить ещё одно обращение, нажмите «Начать заново».');actions([['Начать заново',reset]]);break;
}}
function open(){dialog.hidden=false;launch.setAttribute('aria-expanded','true');input.focus();}
function hide(){dialog.hidden=true;launch.setAttribute('aria-expanded','false');if(recognition)recognition.abort();}
launch.addEventListener('click',()=>dialog.hidden?open():hide());close.addEventListener('click',hide);
send.addEventListener('click',()=>accept(input.value));input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();accept(input.value)}});
const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Speech){
mic.addEventListener('click',()=>{if(recognition){recognition.stop();return;}let rec=new Speech();recognition=rec;rec.lang='ru-RU';rec.interimResults=false;rec.maxAlternatives=1;mic.classList.add('mira-listening');mic.setAttribute('aria-label','Завершить диктовку');rec.onresult=e=>{const value=e.results?.[0]?.[0]?.transcript||'';if(value){transcript.value=value;check.hidden=false;input.disabled=true;send.disabled=true;input.placeholder='Подтвердите распознанный текст';}};rec.onerror=()=>{say('Не удалось распознать голос. Попробуйте снова или напишите сообщение.');};rec.onend=()=>{recognition=null;mic.classList.remove('mira-listening');mic.setAttribute('aria-label','Надиктовать сообщение');};try{rec.start()}catch{recognition=null;}});
}else{mic.disabled=true;mic.title='Голосовой ввод не поддерживается этим браузером';mic.setAttribute('aria-label','Голосовой ввод в этом браузере недоступен');}
el('confirm').addEventListener('click',()=>{const txt=transcript.value.trim();if(!txt)return;check.hidden=true;input.disabled=false;send.disabled=false;input.placeholder='Напишите сообщение';accept(txt);input.focus();});
el('retry').addEventListener('click',()=>{check.hidden=true;transcript.value='';input.disabled=false;send.disabled=false;input.placeholder='Напишите сообщение';if(!mic.disabled)mic.click();});
el('cancel').addEventListener('click',()=>{check.hidden=true;transcript.value='';input.disabled=false;send.disabled=false;input.placeholder='Напишите сообщение';input.focus();});
reset();
})();