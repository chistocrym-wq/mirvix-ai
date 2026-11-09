/* MIRVIX AI analytics. One integration point for every HTML page.
   Yandex Metrika counter 114153852, supplied by the site owner.
   Opt-in consent before third-party analytics; staff and audit pages never use Webvisor.
   AI attribution is based only on known UTM sources/referrers, not guesses. */
(function () {
  'use strict';

  const COUNTER_ID = 114153852;
  const COOKIE_CHOICE = 'mirvix_yandex_analytics_consent_v1';
  const SESSION_AI = 'mirvix_ai_attribution_v1';
  const SENSITIVE_PATH = /^\/(?:cabinet|check|audit|geo-live|geo)(?:\/|$)/i;
  const isSensitivePage = SENSITIVE_PATH.test(location.pathname);
  let initialized = false;
  let consentPanel = null;

  function safeStorage(store, action, key, value) {
    try {
      if (action === 'get') return store.getItem(key);
      if (action === 'set') store.setItem(key, value);
      if (action === 'remove') store.removeItem(key);
    } catch (_) { /* Browser privacy mode: consent and navigation still work. */ }
    return null;
  }

  function parseUrl(value) {
    try { return new URL(value, location.origin); } catch (_) { return null; }
  }

  function aiSourceForHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const exact = {
      'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
      'perplexity.ai': 'Perplexity', 'www.perplexity.ai': 'Perplexity',
      'gemini.google.com': 'Gemini', 'claude.ai': 'Claude',
      'grok.com': 'Grok', 'chat.deepseek.com': 'DeepSeek',
      'giga.chat': 'GigaChat', 'alice.yandex.ru': 'Алиса AI',
      'alice.yandex.com': 'Алиса AI',
      'copilot.microsoft.com': 'Microsoft Copilot',
      'copilot.com': 'Microsoft Copilot',
      'chat.mistral.ai': 'Le Chat (Mistral)',
      'you.com': 'You.com',
      'poe.com': 'Poe'
    };
    return exact[host] || null;
  }

  function aiSourceForUtm(value) {
    const source = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    const names = {
      chatgpt: 'ChatGPT', openaichatgpt: 'ChatGPT',
      perplexity: 'Perplexity', perplexityai: 'Perplexity',
      gemini: 'Gemini', googleai: 'Gemini',
      claude: 'Claude', claudeai: 'Claude',
      grok: 'Grok', xai: 'Grok',
      deepseek: 'DeepSeek', deepseekai: 'DeepSeek',
      gigachat: 'GigaChat', aliceai: 'Алиса AI', yandexalice: 'Алиса AI',
      copilot: 'Microsoft Copilot', microsoftcopilot: 'Microsoft Copilot',
      mistral: 'Le Chat (Mistral)', lechat: 'Le Chat (Mistral)',
      youcom: 'You.com', poe: 'Poe'
    };
    return names[source] || null;
  }

  function sourceFromVisit() {
    const target = parseUrl(location.href);
    const ref = parseUrl(document.referrer);
    const utm = target ? target.searchParams.get('utm_source') : '';
    const viaUtm = aiSourceForUtm(utm);
    if (viaUtm) return {source: viaUtm, method: 'utm_source'};

    const own = location.hostname.replace(/^www\./, '').toLowerCase();
    const host = ref && ref.hostname.replace(/^www\./, '').toLowerCase();
    if (host && host !== own) {
      const viaReferrer = aiSourceForHost(host);
      if (viaReferrer) return {source: viaReferrer, method: 'referrer'};
      safeStorage(sessionStorage, 'remove', SESSION_AI);
      return null;
    }

    const stored = safeStorage(sessionStorage, 'get', SESSION_AI);
    if (!stored) return null;
    try {
      const data = JSON.parse(stored);
      const allowed = [
        'ChatGPT','Perplexity','Gemini','Claude','Grok','DeepSeek',
        'GigaChat','Алиса AI','Microsoft Copilot','Le Chat (Mistral)',
        'You.com','Poe'
      ];
      return allowed.includes(data.source) && data.method === 'session' ? data : null;
    } catch (_) { return null; }
  }

  function initCounter() {
    if (initialized) return;
    initialized = true;
    const url = 'https://mc.webvisor.org/metrika/tag_ww.js?id=' + COUNTER_ID;

    // Yandex Metrika asynchronous counter loader, as supplied by the user.
    (function(m,e,t,r,i,k,a) {
      m[i] = m[i] || function() { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) {
        if (document.scripts[j].src === r) return;
      }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k,a);
    })(window, document, 'script', url, 'ym');

    const safeCurrentUrl = isSensitivePage
      ? location.origin + location.pathname
      : location.href;
    window.ym(COUNTER_ID, 'init', {
      ssr: true,
      webvisor: !isSensitivePage,
      trackHash: true,
      clickmap: !isSensitivePage,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: safeCurrentUrl,
      accurateTrackBounce: true,
      trackLinks: true
    });

    const visit = sourceFromVisit();
    if (visit && visit.source) {
      if (visit.method !== 'session') {
        safeStorage(sessionStorage, 'set', SESSION_AI,
          JSON.stringify({source:visit.source,method:'session'}));
      }
      window.ym(COUNTER_ID, 'params', {
        mirvix_traffic_type: 'ai',
        mirvix_ai_source: visit.source,
        mirvix_ai_attribution: visit.method
      });
      if (visit.method !== 'session' && !safeStorage(sessionStorage,'get','mirvix_ai_arrival_sent_v1')) {
        window.ym(COUNTER_ID, 'reachGoal', 'mirvix_ai_arrival');
        safeStorage(sessionStorage,'set','mirvix_ai_arrival_sent_v1','1');
      }
    }

    document.addEventListener('click', function(event) {
      const anchor = event.target && event.target.closest
        ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const targetUrl = parseUrl(anchor.href);
      if (!targetUrl) return;
      let goal = null;
      if (/^tel:/i.test(anchor.getAttribute('href') || '')) goal = 'mirvix_tel_click';
      else if (/^mailto:/i.test(anchor.getAttribute('href') || '')) goal = 'mirvix_email_click';
      else if (targetUrl.origin === location.origin) {
        const path = targetUrl.pathname;
        if (/^\/check\/?$/.test(path)) goal = 'mirvix_geo_check_open';
        else if (/^\/tariffs\/?$/.test(path)) goal = 'mirvix_tariffs_open';
        else if (/^\/useful\/?$/.test(path)) goal = 'mirvix_useful_open';
      }
      if (goal) window.ym(COUNTER_ID, 'reachGoal', goal);
    }, {passive: true});

    document.addEventListener('submit', function(event) {
      if (event.target && event.target.matches('form')) {
        window.ym(COUNTER_ID, 'reachGoal', 'mirvix_form_submit_attempt');
      }
    }, {passive:true});
  }

  function finishChoice(allowed) {
    safeStorage(localStorage, 'set', COOKIE_CHOICE, allowed ? 'accepted' : 'declined');
    if (consentPanel) {
      consentPanel.remove();
      consentPanel = null;
    }
    if (allowed) initCounter();
  }

  function showConsent() {
    if (consentPanel) return;
    if (!document.body) return;
    if (!document.getElementById('mirvix-consent-css')) {
      const style = document.createElement('style');
      style.id = 'mirvix-consent-css';
      style.textContent =
        '#mirvix-consent{position:fixed;z-index:2147483000;bottom:16px;left:16px;right:16px;max-width:780px;margin:auto;padding:18px 20px;background:#fff;color:#203659;border:1px solid #d4e1f6;border-radius:16px;box-shadow:0 14px 48px #081b4760;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
        '#mirvix-consent p{margin:0 0 12px}' +
        '#mirvix-consent a{color:#146bdc;text-decoration:underline}' +
        '#mirvix-consent .mirvix-consent-actions{display:flex;gap:10px;flex-wrap:wrap}' +
        '#mirvix-consent button{border-radius:10px;border:1px solid #c7d9f3;padding:10px 17px;font:700 13px system-ui,sans-serif;cursor:pointer}' +
        '#mirvix-consent .mirvix-consent-accept{background:#146bdb;color:#fff;border-color:#146bdb}' +
        '#mirvix-consent .mirvix-consent-decline{background:#edf3fb;color:#28466d}' +
        '@media(max-width:500px){#mirvix-consent{bottom:9px;left:9px;right:9px;padding:14px 15px;font-size:12px}}';
      document.head.appendChild(style);
    }
    const banner = document.createElement('aside');
    banner.id = 'mirvix-consent';
    banner.setAttribute('role','region');
    banner.setAttribute('aria-label','Настройки аналитики');
    const msg = document.createElement('p');
    msg.append(document.createTextNode(
      'Мы используем Яндекс Метрику для статистики посещений и источников трафика, включая переходы из ИИ. ' +
      'На публичных страницах возможна запись действий Webvisor. '
    ));
    const link = document.createElement('a');
    link.href = '/legal/privacy/';
    link.textContent = 'Политика конфиденциальности';
    msg.appendChild(link);
    banner.appendChild(msg);
    const actions = document.createElement('div');
    actions.className = 'mirvix-consent-actions';
    for (const [name,yes,cls] of [
      ['Разрешить аналитику',true,'mirvix-consent-accept'],
      ['Без аналитики',false,'mirvix-consent-decline']
    ]) {
      const button=document.createElement('button');
      button.type='button';
      button.className=cls;
      button.textContent=name;
      button.addEventListener('click',()=>finishChoice(yes));
      actions.appendChild(button);
    }
    banner.appendChild(actions);
    document.body.appendChild(banner);
    consentPanel=banner;
  }

  function start() {
    const choice = safeStorage(localStorage,'get',COOKIE_CHOICE);
    if (choice === 'accepted') initCounter();
    else if (choice !== 'declined') showConsent();

    document.addEventListener('click', function(event) {
      const target=event.target && event.target.closest
        ? event.target.closest('#mirvix-cookie-settings') : null;
      if (target) {
        event.preventDefault();
        showConsent();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
