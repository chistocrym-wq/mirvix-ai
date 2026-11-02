(() => {
  'use strict';
  const root = document.getElementById('mira-widget');
  if (!root) return;
  const by = (name) => root.querySelector('[data-mira="' + name + '"]');
  const launch = by('launch');
  const dialog = by('dialog');
  const close = by('close');
  const history = by('history');
  const input = by('input');
  const send = by('send');
  const mic = by('mic');
  const check = by('voicecheck');
  const transcript = by('transcript');
  const handoff = by('handoff');
  const aiConsent = by('ai-consent');
  const deliveryConsent = by('delivery-consent');
  const deliveryPanel = by('delivery-panel');
  const mailLink = by('mail-link');
  const state = {
    mode: 'chat',
    messages: [],
    tasks: [],
    name: '',
    contact: '',
    recognition: null,
    sending: false,
  };
  const sensitive = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;
  const addBubble = (value, own = false) => {
    const node = document.createElement('div');
    node.className = 'mira-bubble' + (own ? ' mine' : '');
    node.textContent = String(value || '');
    history.appendChild(node);
    history.scrollTop = history.scrollHeight;
    return node;
  };
  const say = (v) => addBubble(v);
  const actions = (options) => {
    const row = document.createElement('div');
    row.className = 'mira-quick';
    options.forEach(([title, callback]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.addEventListener('click', callback);
      row.appendChild(button);
    });
    history.appendChild(row);
    history.scrollTop = history.scrollHeight;
  };
  function makeTaskText() {
    const list = state.tasks.slice(-7);
    return list.map((text, index) => (index + 1) + '. ' + text).join('\n');
  }
  const summary = () => ['Всё верно? Проверьте обращение:', '', makeTaskText() || 'Задача не указана', '', 'Как обращаться: ' + state.name, 'Контакт: ' + state.contact].join('\n');
  function reset() {
    state.mode = 'chat';
    state.messages = [];
    state.tasks = [];
    state.name = '';
    state.contact = '';
    deliveryConsent.checked = false;
    deliveryPanel.hidden = true;
    mailLink.hidden = true;
    history.replaceChildren();
    say('Здравствуйте! Я MIRA. Расскажите, какая задача стоит перед вашим бизнесом. Можете написать или надиктовать — я выслушаю, уточню детали и помогу передать обращение специалисту.');
    actions([
      ['Нужен помощник на сайт', () => setExample('Нужен помощник для сайта, который отвечает посетителям круглосуточно.')],
      ['Автоматизация процессов', () => setExample('Хотим автоматизировать обработку заявок и связать сервисы с CRM.')],
      ['Видимость в поиске и ИИ', () => setExample('Хотим улучшить видимость компании в поиске и ИИ-рекомендациях.')],
    ]);
    input.placeholder = 'Расскажите о задаче';
    handoff.hidden = false;
    input.focus();
  }
  function setExample(message) {
    input.value = message;
    input.focus();
  }
  function startHandoff() {
    if (state.sending) return;
    if (state.tasks.length === 0) {
      state.mode = 'collect-task';
      say('Начнём с задачи. Опишите её своими словами — я сохраню эту формулировку для специалиста.');
    } else {
      state.mode = 'collect-name';
      say('Я подготовила описание задачи. Как к вам обращаться?');
    }
    handoff.hidden = true;
    input.focus();
  }
  function showReview() {
    state.mode = 'review';
    deliveryPanel.hidden = false;
    say(summary());
    actions([
      ['Подтвердить и отправить', submitLead],
      ['Исправить описание', () => { state.mode = 'edit-task'; say('Напишите, как правильно сформулировать задачу. Имя и контакт останутся прежними.'); }],
      ['Отправить письмом', openMail],
    ]);
    input.placeholder = 'Можно написать «отправить» или «исправить»';
  }
  function mailBody() {
    return ['Здравствуйте, команда MIRVIX AI!', '', 'Задача:', makeTaskText(), '', 'Как обращаться: ' + state.name, 'Контакт: ' + state.contact, '', 'Я подтверждаю передачу этого обращения для ответа специалиста.'].join('\n');
  }
  function openMail() {
    if (!state.name || !state.contact || !state.tasks.length) {
      say('Сначала уточним задачу и контакты — нажмите «Передать задачу».');
      return;
    }
    const url = 'mailto:mirvixai@mail.ru?subject=' + encodeURIComponent('Обращение через MIRA | MIRVIX AI') + '&body=' + encodeURIComponent(mailBody());
    window.location.href = url;
    say('Я открыла подготовленное письмо. Чтобы передать обращение команде, отправьте его из своей почтовой программы.');
  }
  async function submitLead() {
    if (state.sending || state.mode !== 'review') return;
    if (!deliveryConsent.checked) {
      say('Пожалуйста, подтвердите согласие на передачу заявки в блоке над полем ввода.');
      deliveryConsent.focus();
      return;
    }
    state.sending = true;
    send.disabled = true;
    const progress = say('Передаю обращение специалисту...');
    try {
      const response = await fetch('/api/mira-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: makeTaskText(), name: state.name, contact: state.contact, consent: true, website: '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.delivered !== true) throw Error(data.error || 'Передача заявки недоступна.');
      progress.textContent = 'Готово. Ваше обращение доставлено команде MIRVIX AI. Спасибо!';
      state.mode = 'done';
      deliveryPanel.hidden = true;
      handoff.hidden = true;
      actions([['Новое обращение', reset]]);
    } catch (error) {
      progress.textContent = (error.message || 'Автоматическая доставка недоступна.') + ' Я могу подготовить письмо для отправки.';
      mailLink.hidden = false;
      actions([['Открыть письмо для отправки', openMail], ['Исправить задачу', () => { state.mode = 'edit-task'; say('Напишите исправленное описание задачи.'); }]]);
    } finally {
      state.sending = false;
      send.disabled = false;
    }
  }
  async function askAI(message) {
    if (!aiConsent.checked) {
      say('Чтобы обсудить задачу с MIRA в свободном диалоге, отметьте согласие на обработку текста сообщения. Не указывайте в беседе личные данные. Если хотите просто оставить заявку, нажмите «Передать задачу».');
      return;
    }
    if (sensitive.test(message)) {
      say('Вижу контактные данные. Ради вашей конфиденциальности я не отправляю их ИИ-модели. Нажмите «Передать задачу», и укажете контакт отдельно. Пока можно описать только задачу.');
      return;
    }
    state.messages.push({ role: 'user', content: message.slice(0, 1600) });
    const progress = say('MIRA обдумывает ответ...');
    send.disabled = true;
    try {
      const response = await fetch('/api/mira-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, messages: state.messages.slice(-10) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.reply !== 'string') throw Error(data.error || 'Свободный диалог временно недоступен.');
      const answer = data.reply.trim();
      if (!answer) throw Error('Ответ не получен.');
      progress.textContent = answer;
      state.messages.push({ role: 'assistant', content: answer });
    } catch (error) {
      progress.textContent = (error.message || 'Сервис временно недоступен.') + ' Я могу сохранить вашу задачу и подготовить обращение специалисту.';
      actions([['Передать задачу', startHandoff]]);
      // Avoid long chains of user-only messages if the AI endpoint is temporarily unavailable.
      state.messages = state.messages.slice(0, -1);
    } finally {
      send.disabled = false;
      history.scrollTop = history.scrollHeight;
    }
  }
  function accept(raw) {
    if (state.sending) return;
    const message = String(raw || '').trim().slice(0, 2500);
    if (!message) return;
    input.value = '';
    addBubble(message, true);
    switch (state.mode) {
      case 'chat':
        if (!sensitive.test(message)) state.tasks.push(message.slice(0, 900));
        askAI(message);
        break;
      case 'collect-task':
        state.tasks.push(message.slice(0, 1500));
        state.mode = 'collect-name';
        say('Спасибо, записала. Как к вам обращаться?');
        break;
      case 'collect-name':
        state.name = message.slice(0, 100);
        state.mode = 'collect-contact';
        say('Как с вами удобнее связаться — телефон, e-mail или Telegram? Здесь контакт не отправляется ИИ-модели.');
        break;
      case 'collect-contact':
        state.contact = message.slice(0, 180);
        showReview();
        break;
      case 'edit-task':
        state.tasks = [message.slice(0, 1800)];
        showReview();
        break;
      case 'review':
        if (/^(да|всё верно|все верно|отправить|подтверждаю)/i.test(message)) submitLead();
        else if (/исправить|изменить|нет/i.test(message)) { state.mode = 'edit-task'; say('Напишите исправленную формулировку задачи.'); }
        else say('Чтобы отправить, нажмите «Подтвердить и отправить», а для исправления — «Исправить описание».');
        break;
      default:
        say('Обращение уже подготовлено. Для нового диалога нажмите кнопку ниже.');
        actions([['Новое обращение', reset]]);
    }
  }
  function open() { dialog.hidden = false; launch.setAttribute('aria-expanded', 'true'); input.focus(); }
  function hide() { dialog.hidden = true; launch.setAttribute('aria-expanded', 'false'); if (state.recognition) state.recognition.abort(); }
  launch.addEventListener('click', () => (dialog.hidden ? open() : hide()));
  close.addEventListener('click', hide);
  send.addEventListener('click', () => accept(input.value));
  handoff.addEventListener('click', startHandoff);
  mailLink.addEventListener('click', openMail);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); accept(input.value); }
  });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    mic.addEventListener('click', () => {
      if (state.recognition) { state.recognition.stop(); return; }
      const rec = new Speech();
      state.recognition = rec;
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      mic.classList.add('mira-listening');
      mic.setAttribute('aria-label', 'Завершить диктовку');
      rec.onresult = (event) => {
        const value = event.results?.[0]?.[0]?.transcript || '';
        if (value) {
          transcript.value = value;
          check.hidden = false;
          input.disabled = true;
          send.disabled = true;
        }
      };
      rec.onerror = () => say('Не получилось распознать голос. Попробуйте ещё раз или напишите текстом.');
      rec.onend = () => {
        state.recognition = null;
        mic.classList.remove('mira-listening');
        mic.setAttribute('aria-label', 'Надиктовать сообщение');
      };
      try { rec.start(); } catch { state.recognition = null; }
    });
  } else {
    mic.disabled = true;
    mic.title = 'Браузер не поддерживает голосовой ввод';
    mic.setAttribute('aria-label', 'Голосовой ввод недоступен');
  }
  by('confirm').addEventListener('click', () => {
    const text = transcript.value.trim();
    if (!text) return;
    check.hidden = true;
    input.disabled = false;
    send.disabled = false;
    transcript.value = '';
    accept(text);
    input.focus();
  });
  by('retry').addEventListener('click', () => {
    check.hidden = true;
    transcript.value = '';
    input.disabled = false;
    send.disabled = false;
    if (!mic.disabled) mic.click();
  });
  by('cancel').addEventListener('click', () => {
    check.hidden = true;
    transcript.value = '';
    input.disabled = false;
    send.disabled = false;
    input.focus();
  });
  reset();
})();