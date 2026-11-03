(() => {
  'use strict';
  const root = document.getElementById('mira-widget');
  if (!root) return;
  const by = name => root.querySelector('[data-mira="' + name + '"]');
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
  const deliveryConsent = by('delivery-consent');
  const deliveryPanel = by('delivery-panel');
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const contactPattern = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;
  const yesPattern = /^(?:да|да\s+все\s+верно|да\s+все\s+правильно|все\s+верно|все\s+правильно|верно|правильно|все\s+так|именно|отлично|подтверждаю|согласен|согласна)$/i;
  const noPattern = /^(?:нет|не\s+совсем|неправильно|нужно\s+исправить|исправить|не\s+верно)$/i;
  const state = { phase: 'task', original: [], brief: '', contact: '', busy: false, recognition: null };

  function bubble(text, own = false) {
    const node = document.createElement('div');
    node.className = 'mira-bubble' + (own ? ' mine' : '');
    node.textContent = String(text || '');
    history.appendChild(node);
    history.scrollTop = history.scrollHeight;
    return node;
  }
  const say = text => bubble(text);
  const rawTask = () => state.original.join('\n\n').trim();
  const normalize = text => String(text || '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[.!?;:,]+/g, '').replace(/\s+/g, ' ');
  // Conservative offline version; full semantic rewriting requires an active model.
  function localBrief() {
    const original = rawTask().replace(/^Уточнение(?: или исправление)? клиента:\s*/gim, '').trim();
    let text = original.replace(/\s+/g, ' ').trim();
    const assistant = /(?:бот|чат-бот|ассистент|помощник)/i.test(text);
    let industry = '';
    if (/стоматолог/i.test(text)) industry='стоматологической клиники';
    else if (/парикмахерск/i.test(text)) industry='парикмахерской';
    else if (/салон(?:а|е)? красоты/i.test(text)) industry='салона красоты';
    else if (/ресторан/i.test(text)) industry='ресторана';
    else if (/магазин/i.test(text)) industry='магазина';
    else if (/фитнес|спортзал/i.test(text)) industry='фитнес-центра';
    const heading = assistant ? 'Необходим ИИ-ассистент' + (industry ? ' для ' + industry : '') : 'Требуется решение для бизнес-задачи';
    text=text.replace(/^(?:здравствуйте[,!. ]*|добрый день[,!. ]*)+/i,'')
      .replace(/^(?:ну[, ]*)?(?:мне|нам|мы)\s+(?:нужно|нужен|нужна|нужны|хочу|хотим|ищем)\s*/i,'')
      .replace(/^бот(?:а)?\s+для\s+(?:стоматологии|парикмахерской|салона красоты|ресторана|магазина|фитнес-центра)\s*[,.;:-]?\s*/i,'').trim();
    if (text) text=text.charAt(0).toUpperCase()+text.slice(1).replace(/[.!?]\s*$/,'')+'.';
    return 'Задача: '+heading+'.'+(text?' Пожелания клиента: '+text:'');
  }

  function updateControls() {
    const isBusy = state.busy || !speechCheck.hidden;
    input.disabled = isBusy;
    send.disabled = isBusy;
    mic.disabled = isBusy || !Speech;
    const prompts = {
      task: 'Расскажите о своей задаче',
      review: 'Напишите «да» или что нужно изменить',
      amend: 'Что нужно добавить или исправить?',
      contact: 'Напишите мессенджер или телефон и контакт',
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
    input.value = '';
    aiConsent.checked = false;
    deliveryConsent.checked = false;
    deliveryPanel.hidden = true;
    speechCheck.hidden = true;
    history.replaceChildren();
    say('Здравствуйте! Я MIRA. Расскажите голосом или текстом, что вы хотите сделать. Я внимательно выслушаю, красиво сформулирую задачу и помогу передать её специалисту.');
    updateControls();
  }

  async function reformulate() {
    state.phase = 'formulating';
    state.busy = true;
    deliveryPanel.hidden = true;
    updateControls();
    const original = rawTask();
    const progress = say('Бережно оформляю вашу задачу…');
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
        const polished = data.formulated.trim();
        if (polished.length < 16 || polished.length > 1900) throw new Error('incomplete');
        brief = polished;
      } catch {
        // Keep the local brief; never imply model-generated text when unavailable.
      }
    }
    state.brief = brief;
    progress.textContent = 'Сформулированная задача:\n\n' + brief + '\n\nВсё ли я правильно поняла? Если нужно что-то исправить или добавить, напишите об этом.';
    state.phase = 'review';
    state.busy = false;
    updateControls();
    history.scrollTop = history.scrollHeight;
  }

  function validContact(value) {
    const v = value.trim();
    if (v.length < 5 || v.length > 180) return false;
    if (contactPattern.test(v)) return true;
    if (/\b(?:telegram|телеграм|макс|max|whatsapp|ватсап|телефон|позвонить|почта|email|e-mail)\b/i.test(v)) return false;
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
      progress.textContent = 'Спасибо! Ваше обращение успешно передано специалисту MIRVIX AI.\n\nСогласованная задача:\n' + state.brief + '\n\nСпособ связи: ' + state.contact + '\n\nС вами в кратчайшие сроки свяжется наш специалист. Хорошего вам дня!';
      state.phase = 'sent';
      deliveryPanel.hidden = true;
    } catch {
      state.phase = 'ready';
      progress.textContent = 'Telegram не подтвердил доставку обращения. Повторите отправку стрелкой ➤. Пока подтверждения нет, заявка не считается отправленной.';
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  async function accept(raw) {
    if (state.busy) return;
    const message = String(raw || '').trim();
    if (!message && state.phase === 'ready') return deliver();
    if (!message) return;
    if (message.length > 1800) { say('Пожалуйста, сократите сообщение до 1800 символов, чтобы я могла сохранить его целиком.'); return; }
    if (state.phase === 'sent') reset();
    input.value = '';
    bubble(message, true);
    switch (state.phase) {
      case 'task':
        state.original = [message];
        return reformulate();
      case 'review': {
        const decision = normalize(message);
        if (yesPattern.test(decision)) {
          state.phase = 'contact';
          deliveryPanel.hidden = false;
          say('Спасибо, теперь всё ясно! Как с вами удобнее связаться — по телефону или в Telegram, MAX, WhatsApp либо по электронной почте? Напишите удобный способ и ваш контакт.');
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

  function open() { dialog.hidden = false; launch.setAttribute('aria-expanded','true'); input.focus(); }
  function hide() { dialog.hidden = true; launch.setAttribute('aria-expanded','false'); if (state.recognition) state.recognition.abort(); }
  launch.addEventListener('click', () => (dialog.hidden ? open() : hide()));
  close.addEventListener('click', hide);
  send.addEventListener('click', () => accept(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); accept(input.value); } });
  if (Speech) {
    mic.addEventListener('click', () => {
      if (state.recognition) { state.recognition.stop(); return; }
      const rec = new Speech(); state.recognition = rec; rec.lang = 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 1;
      mic.classList.add('mira-listening'); mic.setAttribute('aria-label','Завершить диктовку');
      rec.onresult = e => {
        const text = e.results?.[0]?.[0]?.transcript || '';
        if (text) { transcript.value = text; speechCheck.hidden = false; updateControls(); }
      };
      rec.onerror = () => say('Не удалось распознать голос. Попробуйте ещё раз или напишите текстом.');
      rec.onend = () => { state.recognition = null; mic.classList.remove('mira-listening'); mic.setAttribute('aria-label','Надиктовать сообщение'); updateControls(); };
      try { rec.start(); } catch { state.recognition = null; updateControls(); }
    });
  } else { mic.title = 'Голосовой ввод в этом браузере недоступен'; mic.setAttribute('aria-label',mic.title); }
  by('confirm').addEventListener('click', () => {
    const text = transcript.value.trim(); if (!text) return;
    transcript.value = ''; speechCheck.hidden = true; updateControls(); accept(text); input.focus();
  });
  by('retry').addEventListener('click', () => {
    transcript.value = ''; speechCheck.hidden = true; updateControls(); if (Speech) mic.click();
  });
  by('cancel').addEventListener('click', () => {
    transcript.value = ''; speechCheck.hidden = true; updateControls(); input.focus();
  });
  reset();
})();