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
  const aiConsent = by('ai-consent');
  const deliveryConsent = by('delivery-consent');
  const deliveryPanel = by('delivery-panel');
  const state = { phase: 'collect', raw: [], formulated: '', recognition: null, busy: false, sending: false };
  const containsContact = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;

  function bubble(value, own = false) {
    const node = document.createElement('div');
    node.className = 'mira-bubble' + (own ? ' mine' : '');
    node.textContent = String(value);
    history.appendChild(node);
    history.scrollTop = history.scrollHeight;
    return node;
  }
  const say = bubble;
  function rawText() { return state.raw.join('\n').trim(); }
  function localBrief() {
    const parts = state.raw.map(x => x.trim()).filter(Boolean);
    return 'Задача: ' + parts.join('\n\n');
  }
  function updateControls() {
    const disabled = state.busy || state.sending;
    input.disabled = disabled || !check.hidden;
    send.disabled = disabled || !check.hidden;
    mic.disabled = disabled || !check.hidden || !speechSupported;
    const ready = state.phase === 'review';
    send.setAttribute('aria-label', ready ? 'Отправить заявку специалисту' : 'Отправить сообщение MIRA');
    send.title = ready ? 'Если всё записано верно, отправить специалисту' : 'Отправить сообщение';
    input.placeholder = ready ? 'Добавьте детали или нажмите ➤ для отправки' : 'Расскажите о своей задаче';
  }
  function reset() {
    state.phase = 'collect';
    state.raw = [];
    state.formulated = '';
    state.busy = false;
    state.sending = false;
    input.value = '';
    deliveryConsent.checked = false;
    deliveryPanel.hidden = true;
    check.hidden = true;
    history.replaceChildren();
    say('Здравствуйте, я MIRA. Расскажите голосом или текстом, что вы хотите сделать. Я оформлю вашу задачу и помогу передать её специалисту.');
    updateControls();
  }
  function addTaskPart(value) {
    const text = value.trim();
    if (!text) return false;
    if (rawText().length + text.length + 1 > 1800) {
      say('Описание получилось длинным. Пожалуйста, сократите его до 1800 символов, чтобы я могла передать всё целиком.');
      return false;
    }
    state.raw.push(text);
    return true;
  }
  async function prepareBrief() {
    state.phase = 'preparing';
    state.busy = true;
    deliveryPanel.hidden = true;
    updateControls();
    const original = rawText();
    const progress = say('Оформляю ваше обращение…');
    let formulated = localBrief();
    // Do not forward a contact to the AI service, even if it was provided voluntarily.
    if (aiConsent.checked && !containsContact.test(original) && original.length <= 1800) {
      try {
        const response = await fetch('/api/mira-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent: true, text: original }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && typeof data.formulated === 'string') {
          const polished = data.formulated.trim();
          if (polished.length >= Math.min(25, original.length) && polished.length <= 1900) formulated = polished;
        }
      } catch { /* Show a faithful local summary if the AI service is not available. */ }
    }
    state.formulated = formulated;
    progress.textContent = 'Вот как я записала вашу задачу:\n\n' + formulated + '\n\nХотите что-нибудь добавить? Если всё верно, просто нажмите стрелку ➤ для отправки специалисту.';
    state.phase = 'review';
    state.busy = false;
    deliveryPanel.hidden = false;
    updateControls();
    history.scrollTop = history.scrollHeight;
  }
  function mailtoFallback() {
    const message = 'Здравствуйте!\n\n' + state.formulated + '\n\nИсходное сообщение:\n' + rawText();
    const url = 'mailto:mirvixai@mail.ru?subject=' + encodeURIComponent('Обращение через MIRA') + '&body=' + encodeURIComponent(message);
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Отправить обращение на электронную почту ↗';
    link.className = 'mira-fallback';
    history.appendChild(link);
    history.scrollTop = history.scrollHeight;
  }
  async function deliver() {
    if (state.phase !== 'review' || state.sending || state.busy) return;
    if (!deliveryConsent.checked) {
      say('Заявка готова. Чтобы отправить её, отметьте согласие на передачу обращения и нажмите стрелку ➤.');
      deliveryConsent.focus();
      return;
    }
    state.sending = true;
    updateControls();
    const progress = say('Передаю специалисту полное обращение…');
    try {
      const response = await fetch('/api/mira-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: state.formulated, original: rawText(), consent: true, website: '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.delivered !== true) throw Error(data.error || 'Telegram не подтвердил доставку.');
      progress.textContent = 'Обращение отправлено специалисту MIRVIX AI.\n\n' + state.formulated + '\n\nСпасибо! Если хотите отправить новую задачу, просто напишите её ниже.';
      state.phase = 'done';
      deliveryPanel.hidden = true;
    } catch (error) {
      progress.textContent = (error.message || 'Доставка пока недоступна.') + '\n\nВаше обращение сохранено в этом окне:\n' + state.formulated + '\n\nМожете отправить его письмом:';
      mailtoFallback();
    } finally {
      state.sending = false;
      updateControls();
    }
  }
  function accept(raw) {
    if (state.busy || state.sending) return;
    const message = String(raw || '').trim();
    if (state.phase === 'review' && message === '') { deliver(); return; }
    if (!message) return;
    if (message.length > 1100) { say('Пожалуйста, сократите одно сообщение до 1100 символов.'); return; }
    input.value = '';
    bubble(message, true);
    if (state.phase === 'done') {
      reset();
      bubble(message, true);
    }
    if (state.phase === 'review') {
      const decision = message.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^(?:нет|нет спасибо|нет больше ничего|больше ничего|ничего|ничего не надо|ничего не нужно|не нужно|не надо|не хочу|не хочу ничего добавлять|все|все верно|все правильно|все хорошо|да все верно|да все правильно|верно|отправить|можно отправлять|готово)$/.test(decision)) {
        deliver();
        return;
      }
      if (/^(?:да|хочу добавить|да хочу добавить|еще|еще есть)$/.test(decision)) {
        state.phase = 'adding';
        say('Хорошо, напишите или надиктуйте, что добавить к задаче.');
        updateControls();
        return;
      }
      // Any substantial answer at this point is an addition, not a replacement with 'да/нет'.
      if (addTaskPart(message)) prepareBrief();
      return;
    }
    if (state.phase === 'collect' || state.phase === 'adding') {
      if (addTaskPart(message)) prepareBrief();
      return;
    }
    say('Я уже оформляю обращение.');
  }
  function open() { dialog.hidden = false; launch.setAttribute('aria-expanded', 'true'); input.focus(); }
  function hide() { dialog.hidden = true; launch.setAttribute('aria-expanded', 'false'); if (state.recognition) state.recognition.abort(); }
  launch.addEventListener('click', () => (dialog.hidden ? open() : hide()));
  close.addEventListener('click', hide);
  send.addEventListener('click', () => accept(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); accept(input.value); } });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = Boolean(Speech);
  if (speechSupported) {
    mic.addEventListener('click', () => {
      if (state.recognition) { state.recognition.stop(); return; }
      const rec = new Speech();
      state.recognition = rec;
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      mic.classList.add('mira-listening');
      mic.setAttribute('aria-label', 'Завершить диктовку');
      rec.onresult = event => {
        const heard = event.results?.[0]?.[0]?.transcript || '';
        if (heard) { transcript.value = heard; check.hidden = false; updateControls(); }
      };
      rec.onerror = () => say('Не удалось распознать речь. Попробуйте ещё раз или напишите текстом.');
      rec.onend = () => {
        state.recognition = null;
        mic.classList.remove('mira-listening');
        mic.setAttribute('aria-label', 'Надиктовать сообщение');
        updateControls();
      };
      try { rec.start(); } catch { state.recognition = null; updateControls(); }
    });
  } else { mic.title = 'Голосовой ввод недоступен в этом браузере'; }
  by('confirm').addEventListener('click', () => {
    const heard = transcript.value.trim();
    if (!heard) return;
    transcript.value = '';
    check.hidden = true;
    updateControls();
    accept(heard);
    input.focus();
  });
  by('retry').addEventListener('click', () => {
    transcript.value = '';
    check.hidden = true;
    updateControls();
    if (speechSupported) mic.click();
  });
  by('cancel').addEventListener('click', () => {
    transcript.value = '';
    check.hidden = true;
    updateControls();
    input.focus();
  });
  reset();
})();