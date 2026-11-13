(() => {
  'use strict';
  const root = document.getElementById('mira-widget');
  if (!root) return;
  const by = name => root.querySelector('[data-mira="' + name + '"]');
  const consentKey = 'mirvix_mira_ai_choice_v1';
  let consentChoice = null;
  try { const stored = window.localStorage?.getItem(consentKey); if (stored === 'allowed' || stored === 'declined') consentChoice = stored; } catch {}
  const rememberChoice = choice => {
    consentChoice = choice;
    try { window.localStorage?.setItem(consentKey, choice); } catch {}
  };
  const launch = by('launch');
  const dialog = by('dialog');
  const close = by('close');
  const history = by('history');
  const input = by('input');
  const send = by('send');
  const mic = by('mic');
  const speechCheck = by('voicecheck');
  const transcript = by('transcript');
  const aiConsent = by('ai-consent');
  const welcome = by('welcome');
  const allowAI = by('allow-ai');
  const denyAI = by('deny-ai');
  const settingsAI = by('ai-settings');
  const deliveryConsent = by('delivery-consent');
  const deliveryPanel = by('delivery-panel');
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const Recorder = window.MediaRecorder;
  const mediaDevices = window.navigator?.mediaDevices;
  const canRecord = !!(Recorder && mediaDevices?.getUserMedia);
  const contactPattern = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;
  const yesPattern = /^(?:да|да\s+все\s+верно|да\s+все\s+правильно|все\s+верно|все\s+правильно|верно|правильно|все\s+так|именно|отлично|подтверждаю|согласен|согласна)$/i;
  const noPattern = /^(?:нет|не\s+совсем|неправильно|нужно\s+исправить|исправить|не\s+верно)$/i;
  const byePattern = /^(?:пока|до\s+свидания|до\s+связи|всего\s+доброго|всего\s+хорошего|спасибо[,! ]*пока|спасибо[,! ]*до\s+свидания)$/i;
  const helloPattern = /^(?:привет|здравствуй(?:те)?|добрый\s+(?:день|вечер|утро))[!. ]*$/i;
  const state = { phase: 'task', original: [], brief: '', contact: '', busy: false, recognition: null, recorder: null, stream: null, voiceTimer: null, preferRecording: false, dialogue: [], greeted: false, saidGoodbye: false, reformulations: 0, lastAccepted: '', lastAcceptedAt: 0 };

  function bubble(text, own = false) {
    const node = document.createElement('div');
    node.className = 'mira-bubble' + (own ? ' mine' : '');
    node.textContent = String(text || '');
    history.appendChild(node);
    history.scrollTop = history.scrollHeight;
    return node;
  }
  const say = text => bubble(text);
  const destinationMap = Object.freeze({
    '/legal/contacts/':'Контакты MIRVIX AI',
    '/tariffs/#geo':'GEO-тарифы и состав работ',
    '/tariffs/#support':'Пакеты сопровождения',
    '/check/':'Проверка упоминаний в ИИ',
    '/tools/':'Инструменты MIRVIX',
    '/legal/privacy/':'Политика конфиденциальности'
  });
  const localLinkHints = message => {
    const v = String(message||'').toLowerCase();
    const links=[];
    if(/контакт|связ|телефон|адрес|почт|реквизит/.test(v))links.push('/legal/contacts/');
    if(/тариф|цен|стоимост|пакет|сколько стоит/.test(v))links.push('/tariffs/#geo');
    if(/сопровождени|ежемесяч|поддержк/.test(v))links.push('/tariffs/#support');
    if(/провер.*(?:ии|нейросет)|упоминан/.test(v))links.push('/check/');
    return [...new Set(links)];
  };
  function attachSiteLinks(node, links) {
    if (!node || !Array.isArray(links) || !links.length) return;
    const allowed=links.map(x=>typeof x==='string'?x:x?.href).filter(x=>Object.prototype.hasOwnProperty.call(destinationMap,x)).slice(0,3);
    if(!allowed.length)return;
    const row=document.createElement('div');row.className='mira-linkrow';
    for(const href of [...new Set(allowed)]){
      const a=document.createElement('a');a.href=href;a.textContent=destinationMap[href];
      a.className='mira-link';row.appendChild(a);
    }
    node.appendChild(row);
  }
  const rawTask = () => state.original.join('\n\n').trim();
  const normalize = text => String(text || '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[.!?;:,]+/g, '').replace(/\s+/g, ' ');
  // Transparent offline fallback: summarize intent rather than copy customer prose.
  // Semantic one-sentence rewriting is provided by /api/mira-brief only after opt-in.
  function localBrief() {
    const task=rawTask();
    const industry=/стоматолог/i.test(task)?'стоматологической клиники':
      /парикмахерск/i.test(task)?'парикмахерской':
      /салон(?:а|е)? красоты/i.test(task)?'салона красоты':
      /медицинск|клиник/i.test(task)?'клиники':
      /ресторан|кафе/i.test(task)?'ресторана или кафе':
      /магазин|торгов/i.test(task)?'магазина':
      /фитнес|спортзал/i.test(task)?'фитнес-центра':'';
    const subject=industry?' для '+industry:'';
    let objective='Требуется подобрать цифровое решение для бизнес-задачи';
    if (/бот|чат-бот|ассистент|помощник/i.test(task)) objective='Нужно разработать ИИ-помощника'+subject;
    else if (/\bcrm\b|црм|срм/i.test(task)) objective='Необходимо внедрить или настроить CRM'+subject;
    else if (/сайт|лендинг|интернет-магазин/i.test(task)) objective='Требуется создать или доработать сайт'+subject;
    else if (/заявк|заказ|обращени/i.test(task)) objective='Нужно автоматизировать обработку обращений и заявок'+subject;
    else if (/продвижен|seo|гео|нейросет|видимост/i.test(task)) objective='Необходимо усилить видимость компании в нейросетях и ИИ-поиске';
    else if (/приложени/i.test(task)) objective='Требуется разработать приложение'+subject;
    const details=[];
    if (/запис[ьи]|записыва|бронирован/i.test(task)) details.push('запись клиентов');
    if (/отвеча|ответ[ыа]|консультац/i.test(task)) details.push('ответы на вопросы клиентов');
    if (/telegram|телеграм/i.test(task)) details.push('работа через Telegram');
    if (/оплат[ау]|платеж/i.test(task)) details.push('приём платежей');
    if (details.length) objective+=' с функциями: '+details.slice(0,3).join(', ');
    return objective.replace(/[.!?;,\s]+$/,'').slice(0,290)+'.';
  }

  function updateControls() {
    const isBusy = state.busy || !speechCheck.hidden;
    input.disabled = isBusy;
    send.disabled = isBusy;
    mic.disabled = isBusy || (!Speech && !canRecord);
    const prompts = {
      task: 'Расскажите о своей задаче',
      review: 'Напишите «да» или что нужно изменить',
      amend: 'Что нужно добавить или исправить?',
      contact: 'Напишите Telegram, MAX, телефон или электронную почту',
      ready: 'Нажмите ➤ для отправки',
      sent: 'Новая задача? Напишите её здесь',
    };
    input.placeholder = prompts[state.phase] || 'Напишите сообщение';
    send.title = state.phase === 'ready' ? 'Отправить согласованную задачу специалисту' : 'Отправить сообщение MIRA';
    send.setAttribute('aria-label', send.title);
  }

  function reset() {
    state.phase = 'task';
    state.original = [];
    state.brief = '';
    state.contact = '';
    state.busy = false;
    state.greeted = false;
    state.saidGoodbye = false;
    state.reformulations = 0;
    state.dialogue = [];
    state.lastAccepted = '';
    state.lastAcceptedAt = 0;
    input.value = '';
    aiConsent.checked = consentChoice === 'allowed';
    deliveryConsent.checked = false;
    deliveryPanel.hidden = true;
    speechCheck.hidden = true;
    history.replaceChildren();
    // Never initiate a chat: wait for the visitor's first message.
    updateControls();
  }

  async function reformulate() {
    state.phase = 'formulating';
    state.busy = true;
    deliveryPanel.hidden = true;
    updateControls();
    const original = rawTask();
    const progress = say('Сформулирую задачу одним предложением…');
    let brief = localBrief();
    // Use the local brief without distracting visitors with provider status messages.
    if (aiConsent.checked && !contactPattern.test(original)) {
      try {
        const response = await fetch('/api/mira-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: original, consent: true }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.formulated !== 'string') throw new Error('unavailable');
        const polished=data.formulated.trim().replace(/^Задача:\s*/i,'').replace(/\s+/g,' ');
        const first=polished.match(/^(.+?[.!?])(?:\s|$)/)?.[1]||polished;
        if (first.length < 16 || first.length > 450) throw new Error('incomplete');
        brief=first.replace(/[.!?\s]+$/,'')+'.';
      } catch {
        // Keep the local brief; never imply model-generated text when unavailable.
      }
    }
    state.brief = brief;
    progress.textContent = (state.reformulations ? 'Уточнила задачу: ' : 'Сформулирую так: ') + brief + (state.reformulations ? '\n\nЕсли описание подходит, напишите «да»; иначе уточните детали.' : '\n\nВсё верно или нужно что-то уточнить?');
    state.reformulations += 1;
    state.phase = 'review';
    state.busy = false;
    updateControls();
    history.scrollTop = history.scrollHeight;
  }

  function validContact(value) {
    const v = value.trim();
    if (v.length < 5 || v.length > 180) return false;
    if (contactPattern.test(v)) return true;
    if (/\b(?:telegram|телеграм|макс|max|телефон|позвонить|почта|email|e-mail)\b/i.test(v)) return false;
    // Accept a meaningful other contact such as a public social profile URL.
    return /^https:\/\/\S{8,}$/i.test(v);
  }
  async function deliver() {
    if (state.busy || !['ready', 'contact'].includes(state.phase) || !state.contact) return;
    if (!deliveryConsent.checked) {
      state.phase = 'ready';
      say('Я подготовила обращение полностью. Для отправки специалисту отметьте согласие на передачу данных под чатом и нажмите стрелку ➤.');
      updateControls();
      deliveryConsent.focus();
      return;
    }
    state.phase = 'sending';
    state.busy = true;
    updateControls();
    const progress = say('Передаю согласованное обращение специалисту…');
    try {
      const response = await fetch('/api/mira-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: state.brief, original: rawTask(), contact: state.contact, consent: true, website: '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.delivered !== true) throw new Error(data.error || 'Нет подтверждения отправки.');
      progress.textContent = 'Спасибо! Ваше обращение успешно передано специалисту MIRVIX AI.\n\nСогласованная задача:\n' + state.brief + '\n\nСпособ связи: ' + state.contact + '\n\nСпециалист свяжется с вами в ближайшее время. Спасибо за обращение, всего доброго!';
      state.phase = 'sent';
      state.saidGoodbye = true;
      deliveryPanel.hidden = true;
    } catch {
      state.phase = 'ready';
      progress.textContent = 'Telegram не подтвердил доставку обращения. Повторите отправку стрелкой ➤. Пока подтверждения нет, заявка не считается отправленной.';
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  function isBusinessTask(text) {
    return /(?:мне\s+нуж(?:ен|на|но)|хочу\s+(?:заказать|создать|разработать|внедрить|подключить)|нужно\s+(?:создать|настроить|разработать|подключить|автоматизировать)|требуется\s+(?:бот|сайт|разработ|интеграц)|ищу\s+(?:разработчика|исполнителя))/i.test(text)
      && !/^(?:как|почему|сколько|какие|что|когда|можно\s+ли|помогаете\s+ли)\b/i.test(text);
  }
  async function chatReply(message) {
    if (contactPattern.test(message)) {
      say('Для безопасности не присылайте здесь контакты. Если хотите оставить заявку, напишите «Оформить заявку».');
      return;
    }
    if (!aiConsent.checked) {
      const m=say('В этом режиме ИИ выключен. Для свободного диалога нажмите ⚙ в заголовке и выберите «Разрешить ИИ».');
      attachSiteLinks(m,localLinkHints(message));
      return;
    }
    state.busy = true; updateControls();
    const pending = say('Разбираюсь в вашем вопросе…');
    const messages = [...state.dialogue.slice(-8), {role:'user',content:message}];
    try {
      const response = await fetch('/api/mira-chat', {
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages,consent:true})
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.reply) throw Error(data.error||'Не удалось получить ответ.');
      pending.textContent = String(data.reply).slice(0,1200);
      state.dialogue = [...messages,{role:'assistant',content:pending.textContent}].slice(-10);
      attachSiteLinks(pending,Array.isArray(data.links)&&data.links.length?data.links:localLinkHints(message));
    } catch {
      pending.textContent = 'Сейчас не могу получить ответ от ИИ. Можете задать вопрос повторно или описать задачу для специалиста MIRVIX AI. Для оформления напишите «Оформить заявку».';
    } finally { state.busy=false;updateControls();history.scrollTop=history.scrollHeight; }
  }
  async function accept(raw) {
    if (state.busy) return;
    const message = String(raw || '').trim();
    if (!message && state.phase === 'ready') return deliver();
    if (!message) return;
    if (message.length > 1800) { say('Пожалуйста, сократите сообщение до 1800 символов, чтобы я могла сохранить его целиком.'); return; }
    const now=Date.now();
    // Ignore duplicate click / Enter / voice confirmation of the same input in a short window.
    if (message === state.lastAccepted && now - state.lastAcceptedAt < 2500) return;
    state.lastAccepted=message;state.lastAcceptedAt=now;
    if (state.phase === 'sent') reset();
    input.value = '';
    bubble(message, true);
    if (!state.greeted) {
      state.greeted = true;
      say('Здравствуйте! Я MIRA, рада помочь.');
    }
    if (byePattern.test(normalize(message))) {
      if (!state.saidGoodbye) say('Спасибо за разговор! Всего доброго, до связи.');
      state.saidGoodbye = true;
      state.phase = 'sent';
      deliveryPanel.hidden = true;
      updateControls();
      return;
    }
    if (state.phase === 'task' && helloPattern.test(normalize(message))) {
      say('Расскажите, пожалуйста, какую задачу хотите решить.');
      return;
    }
    switch (state.phase) {
      case 'task':
        if (/^(?:оформить заявку|оставить заявку|передать задачу|связаться со специалистом)$/i.test(normalize(message))) {
          say('Опишите, пожалуйста, что нужно сделать для вашего бизнеса. Я сформулирую задачу для специалиста.');
          return;
        }
        if (isBusinessTask(message)) {
          state.original = [message];
          return reformulate();
        }
        return chatReply(message);
      case 'review': {
        const decision = normalize(message);
        if (yesPattern.test(decision)) {
          state.phase = 'contact';
          deliveryPanel.hidden = false;
          say('Спасибо, теперь всё ясно! Как с вами удобнее связаться — по телефону, в Telegram, MAX или по электронной почте? Напишите удобный способ и ваш контакт.');
          updateControls();
          return;
        }
        if (noPattern.test(decision)) {
          state.phase = 'amend';
          say('Спасибо, что уточнили. Напишите или надиктуйте, что нужно поправить или добавить в описание.');
          updateControls();
          return;
        }
        // Any substantive reply at review stage is a correction, not an order to send.
        if (rawTask().length + message.length > 1900) { say('Описание уже подробное. Пожалуйста, напишите краткое уточнение.'); return; }
        state.original.push('Уточнение клиента: ' + message);
        return reformulate();
      }
      case 'amend':
        if (rawTask().length + message.length > 1900) { say('Пожалуйста, сократите уточнение.'); return; }
        state.original.push('Уточнение или исправление клиента: ' + message);
        return reformulate();
      case 'contact':
        if (!validContact(message)) {
          say('Напишите, пожалуйста, сам номер телефона, адрес электронной почты или @имя в мессенджере, чтобы специалист действительно смог вам ответить.');
          return;
        }
        state.contact = message;
        state.phase = 'ready';
        updateControls();
        return deliver();
      case 'ready':
        if (yesPattern.test(normalize(message)) || /^(?:отправить|готово|подтверждаю)$/i.test(normalize(message))) return deliver();
        if (validContact(message)) { state.contact = message; say('Контакт обновила.'); return deliver(); }
        say('Я готова отправить ваше обращение. Проверьте согласие под чатом и нажмите стрелку ➤.');
        return;
      default:
        return;
    }
  }

  const mobileMedia = window.matchMedia?.('(max-width: 960px)');
  const widgetHome = root;
  const header = document.querySelector('.site-header .header-inner');
  function dockLauncher() {
    // Desktop: viewport-fixed outside backdrop-filtered sticky header.
    // Mobile: an ordinary flex item in the header, never floating over CTA buttons.
    const toHeader=!!mobileMedia?.matches && !!header;
    const destination=toHeader?header:widgetHome;
    if (launch.parentElement !== destination) {
      if (toHeader) {
        const toggle=header.querySelector('.mobile-toggle');
        if (toggle) header.insertBefore(launch,toggle);
        else destination.appendChild(launch);
      } else destination.insertBefore(launch,destination.firstChild);
    }
  }
  dockLauncher();
  mobileMedia?.addEventListener?.('change',dockLauncher);
  function open() {
    dialog.hidden = false;
    if (welcome) welcome.hidden = consentChoice !== null;
    launch.setAttribute('aria-expanded','true');
    document.body.classList.add('mira-chat-open');
    if (welcome && !welcome.hidden) allowAI?.focus?.();
    else input.focus();
  }
  function hide() {
    dialog.hidden = true;
    launch.setAttribute('aria-expanded','false');
    document.body.classList.remove('mira-chat-open');
    if (state.recognition) state.recognition.abort();
    if (state.recorder?.state==='recording') state.recorder.stop();
    launch.focus();
  }
  launch.addEventListener('click', () => (dialog.hidden ? open() : hide()));
  allowAI?.addEventListener('click', () => {
    rememberChoice('allowed');aiConsent.checked=true;
    if(welcome)welcome.hidden=true; input.focus();
  });
  denyAI?.addEventListener('click', () => {
    rememberChoice('declined');aiConsent.checked=false;
    state.dialogue=[];
    if(welcome)welcome.hidden=true; input.focus();
  });
  settingsAI?.addEventListener('click', () => {
    if(welcome){ welcome.hidden=false; allowAI?.focus?.(); }
  });
  close.addEventListener('click', hide);
  send.addEventListener('click', () => accept(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); accept(input.value); } });
  function voiceError(text) {
    say(text||'Не удалось обработать голос. Проверьте доступ к микрофону или напишите сообщение текстом.');
  }
  function showTranscript(text){
    const value=String(text||'').trim();
    if(!value){voiceError('Речь не распознана. Попробуйте снова или напишите текстом.');return;}
    transcript.value=value;
    speechCheck.hidden=false;
    updateControls();
  }
  function stopMedia(){
    if(state.voiceTimer){clearTimeout(state.voiceTimer);state.voiceTimer=null;}
    if(state.stream){for(const track of state.stream.getTracks())track.stop();state.stream=null;}
    state.recorder=null;
    mic.classList.remove('mira-listening');
    mic.setAttribute('aria-label','Надиктовать сообщение');
    updateControls();
  }
  async function startMediaRecorder(){
    if(!canRecord){voiceError('Этот браузер не поддерживает запись голоса на сайте. Можно воспользоваться голосовым вводом клавиатуры или написать текстом.');return;}
    if(!aiConsent.checked){voiceError('Для распознавания через ИИ нажмите ⚙ в заголовке чата и разрешите ИИ.');return;}
    try{
      const stream=await mediaDevices.getUserMedia({audio:true,video:false});
      state.stream=stream;
      const formats=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
      const type=formats.find(t=>Recorder.isTypeSupported?.(t));
      const rec=type?new Recorder(stream,{mimeType:type}):new Recorder(stream);
      state.recorder=rec;
      const chunks=[];
      rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      rec.onerror=()=>{stopMedia();voiceError('Запись прервана. Проверьте разрешение микрофона или напишите текстом.');};
      rec.onstop=async()=>{
        const mime=rec.mimeType||'audio/webm';
        stopMedia();
        if(!chunks.length)return voiceError('Звук не записан. Попробуйте снова.');
        state.busy=true;updateControls();
        const progress=say('Распознаю голосовое сообщение…');
        const body=new FormData();
        body.append('consent','true');
        body.append('audio',new Blob(chunks,{type:mime}),'mira-voice');
        const ctl=new AbortController();
        const timer=setTimeout(()=>ctl.abort(),25000);
        try{
          const response=await fetch('/api/mira-transcribe',{method:'POST',body,signal:ctl.signal,credentials:'same-origin'});
          const data=await response.json().catch(()=>({}));
          if(!response.ok||!data.text)throw Error(data.error||'Не удалось распознать голос.');
          progress.textContent='Готово! Проверьте текст перед отправкой.';
          showTranscript(data.text);
        }catch(e){progress.textContent=e.name==='AbortError'?'Время распознавания истекло. Попробуйте ещё раз.':
          (e.message||'Распознавание недоступно. Напишите текстом.');}
        finally{clearTimeout(timer);state.busy=false;updateControls();}
      };
      rec.start();
      mic.classList.add('mira-listening');
      mic.title='Нажмите ещё раз, чтобы завершить запись';
      mic.setAttribute('aria-label','Завершить запись');
      state.voiceTimer=setTimeout(()=>{if(state.recorder?.state==='recording')state.recorder.stop();},15000);
    }catch(e){
      stopMedia();
      voiceError(e?.name==='NotAllowedError'?'Доступ к микрофону запрещён. Разрешите его для сайта в настройках браузера.':
        'Не удалось включить микрофон. Проверьте разрешения браузера и устройство.');
    }
  }
  function startSpeech(){
    if(!aiConsent.checked){voiceError('Для распознавания речи нажмите ⚙ в заголовке чата и разрешите использование ИИ.');return;}
    const rec=new Speech();state.recognition=rec;rec.lang='ru-RU';rec.interimResults=false;rec.maxAlternatives=1;
    mic.classList.add('mira-listening');mic.setAttribute('aria-label','Завершить диктовку');
    rec.onresult=e=>showTranscript(e.results?.[0]?.[0]?.transcript||'');
    rec.onerror=e=>{
      state.preferRecording=canRecord;
      if(e.error==='not-allowed'||e.error==='service-not-allowed')voiceError('Браузер запретил доступ к голосу. Разрешите микрофон и повторите попытку.');
      else voiceError(canRecord?'Распознавание браузера недоступно. Нажмите микрофон ещё раз — используем защищённую запись через сервер.':
        'Голосовое распознавание в этом браузере не работает. Напишите текстом.');
    };
    rec.onend=()=>{state.recognition=null;mic.classList.remove('mira-listening');mic.setAttribute('aria-label','Надиктовать сообщение');updateControls();};
    try{rec.start();}catch{state.recognition=null;state.preferRecording=canRecord;updateControls();voiceError('Распознавание браузера не запустилось. Попробуйте микрофон ещё раз.');}
  }
  mic.addEventListener('click',()=>{
    if(state.recognition){state.recognition.stop();return;}
    if(state.recorder){if(state.recorder.state==='recording')state.recorder.stop();return;}
    if(Speech&&!state.preferRecording)return startSpeech();
    return startMediaRecorder();
  });
  if(!Speech&&!canRecord){mic.title='Голосовой ввод недоступен в этом браузере';mic.setAttribute('aria-label',mic.title);}

  by('confirm').addEventListener('click', () => {
    const text = transcript.value.trim(); if (!text) return;
    transcript.value = ''; speechCheck.hidden = true; updateControls(); accept(text); input.focus();
  });
  by('retry').addEventListener('click', () => {
    transcript.value = ''; speechCheck.hidden = true; updateControls(); mic.click();
  });
  by('cancel').addEventListener('click', () => {
    transcript.value = ''; speechCheck.hidden = true; updateControls(); input.focus();
  });
  reset();
})();