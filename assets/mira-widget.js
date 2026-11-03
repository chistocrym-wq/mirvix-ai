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
  const localBrief = () => 'Задача клиента:\n' + rawTask();

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
    say('Здравствуйте! Я MIRA. Расскажите голосом или текстом, что вы хотите сделать. Я внимательно выслушаю, красиво сформулирую задачу и помогу передать её специалисту. Для оформления с помощью ИИ отметьте согласие под перепиской.');
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
    let fallbackReason = '';
    if (!aiConsent.checked) {
      fallbackReason = 'Чтобы MIRA могла переформулировать текст с помощью ИИ, отметьте согласие внизу чата. Пока я сохраню ваши слова без изменений.';
    } else if (contactPattern.test(original)) {
      fallbackReason = 'В тексте есть контакты, поэтому я не передаю его ИИ-сервису и сохраняю без изменений.';
    } else {
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
        fallbackReason = 'Сейчас автоматическое оформление недоступно, поэтому я сохранила ваше описание без изменений.';
      }
    }
    state.brief = brief;
    progress.textContent = (fallbackReason ? fallbackReason + '\n\n' : '') + 'Вот как я поняла вашу задачу:\n\n' + brief + '\n\nВсё ли я правильно поняла? Если нужно что-то добавить или исправить, напишите это.';
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
  function quoteForTask(text) {
    const words = text.toLocaleLowerCase('ru');
    if (/время|заявк|рутин|автомат|бот|crm|запис|эффективн/.test(words)) {
      return 'На прощание — мысль Бенджамина Франклина: «Время — деньги». Пусть новое решение освободит больше времени для вашего главного дела.';
    }
    if (/сайт|поиск|seo|информац|образован|обучен|данн/.test(words)) {
      return 'На прощание — слова Фрэнсиса Бэкона: «Знание — сила». Пусть ваш опыт и знания станут заметнее клиентам.';
    }
    return 'На прощание — мысль Лао-цзы: «Путь в тысячу ли начинается с первого шага». Желаю вашему проекту хорошего начала!';
  }
  function emailFallback() {
    const subject = encodeURIComponent('Заявка от клиента через MIRA — MIRVIX AI');
    const body = encodeURIComponent('Здравствуйте, MIRVIX AI!\n\nСогласованная задача:\n' + state.brief + '\n\nСлова клиента:\n' + rawTask() + '\n\nПредпочтительный контакт:\n' + state.contact);
    const a = document.createElement('a');
    a.className = 'mira-fallback';
    a.href = 'mailto:mirvixai@mail.ru?subject=' + subject + '&body=' + body;
    a.textContent = 'Открыть подготовленное письмо для отправки ↗';
    history.appendChild(a);
    history.scrollTop = history.scrollHeight;
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
      progress.textContent = 'Готово! Ваше обращение доставлено специалисту MIRVIX AI.\n\n' + state.brief + '\n\nКак с вами связаться: ' + state.contact + '\n\nБлагодарю за обращение! Специалист свяжется с вами по указанному контакту.\n\n' + quoteForTask(rawTask());
      state.phase = 'sent';
      deliveryPanel.hidden = true;
    } catch {
      state.phase = 'ready';
      progress.textContent = 'Ваше обращение готово, но Telegram пока не подтвердил его доставку. Я не буду утверждать, что оно отправлено. Вы можете отправить подготовленный текст на электронную почту:';
      emailFallback();
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