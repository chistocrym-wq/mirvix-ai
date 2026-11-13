(() => {
  'use strict';
  const form = document.getElementById('free-ai-form');
  const access = document.getElementById('geo-check');
  const toggle = document.getElementById('free-ai-toggle');
  const disclosure = document.getElementById('free-ai-disclosure');
  if (!form || !access) return;

  const field = name => form.elements.namedItem(name);
  const status = document.getElementById('free-ai-status');
  const compare = document.getElementById('free-ai-compare');
  const competitor = document.getElementById('free-ai-competitor');
  const channel = document.getElementById('free-ai-channel');
  const contact = document.getElementById('free-ai-contact');
  const submit = document.getElementById('free-ai-submit');
  let pendingRequestId = null;

  async function checkStaff() {
    access.hidden = true;
    try {
      const r = await fetch('/.netlify/functions/cabinet-auth', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Mirvix-Cabinet': '1' },
        body: JSON.stringify({ action: 'status' })
      });
      if (!r.ok) return;
      const data = await r.json();
      access.hidden = data.role !== 'staff';
    } catch {
      access.hidden = true;
    }
  }

  function setExpanded(expanded) {
    if (!toggle || !disclosure) return;
    disclosure.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    if (expanded) disclosure.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  toggle?.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
  });

  compare.addEventListener('change', () => {
    competitor.hidden = !compare.checked;
    if (!compare.checked) {
      field('competitor').value = '';
      field('competitorSite').value = '';
    }
  });

  function setContactMode() {
    if (channel.value === 'email') {
      contact.type = 'email';
      contact.inputMode = 'email';
      contact.autocomplete = 'email';
      contact.placeholder = 'you@company.ru';
    } else if (channel.value === 'telegram') {
      contact.type = 'text';
      contact.inputMode = 'text';
      contact.autocomplete = 'off';
      contact.placeholder = '@username или https://t.me/username';
    } else {
      contact.type = 'tel';
      contact.inputMode = 'tel';
      contact.autocomplete = 'tel';
      contact.placeholder = '+7 900 000-00-00';
    }
    contact.value = '';
  }
  channel.addEventListener('change', setContactMode);

  function showStatus(value, state = 'info') {
    status.textContent = value;
    status.dataset.state = state;
  }

  const textValue = (name, limit) => String(field(name)?.value || '').trim().slice(0, limit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = {
      company: textValue('company', 120),
      site: textValue('site', 240),
      category: textValue('category', 180),
      wantsCompetitor: compare.checked,
      competitor: compare.checked ? textValue('competitor', 120) : '',
      competitorSite: compare.checked ? textValue('competitorSite', 240) : '',
      questions: textValue('questions', 1000),
      name: textValue('name', 100),
      channel: channel.value,
      contact: textValue('contact', 180),
      consent: document.getElementById('free-ai-consent').checked,
      extra_url: textValue('extra_url', 100),
      requestId: pendingRequestId || (pendingRequestId = crypto.randomUUID())
    };
    submit.disabled = true;
    showStatus('Отправляем заявку в MIRVIX AI…');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 16000);
      let response;
      try {
        response = await fetch('/api/ai-visibility-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: controller.signal,
          credentials: 'same-origin'
        });
      } finally { clearTimeout(timer); }
      const result = await response.json();
      if (!response.ok || result.submitted !== true) {
        throw Error(result.error || 'Заявка не доставлена.');
      }
      showStatus(result.notified === true
        ? 'Заявка успешно отправлена специалисту MIRVIX AI. Мы свяжемся с вами по указанному контакту.'
        : 'Заявка сохранена в системе MIRVIX AI, но уведомление специалисту задерживается. Мы обработаем её из кабинета заявок.', 'success');
      pendingRequestId = null;
      form.reset();
      competitor.hidden = true;
      setContactMode();
    } catch (error) {
      // If server accepted but browser lost the response, reuse the same request ID.
      const reason = error.name === 'AbortError' ?
        'Сервис не ответил. Проверьте соединение и попробуйте отправить заявку ещё раз.' :
        String(error.message || 'Не удалось отправить заявку.');
      showStatus(reason + ' Если ошибка повторится, напишите на mirvixai@mail.ru.', 'error');
    } finally { submit.disabled = false; }
  });

  checkStaff();
})();