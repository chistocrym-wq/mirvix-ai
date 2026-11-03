// MIRVIX AI / MIRA. Deliver an explicitly approved customer brief to the configured owner Telegram chat.
// Set MIRA_TELEGRAM_BOT_TOKEN and MIRA_TELEGRAM_CHAT_ID in Netlify environment variables.
// Never expose those values in JavaScript served to browsers or in source control.
const reply = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export default async function handler(request) {
  if (request.method === 'GET') {
    return reply({ deliveryConfigured: Boolean(process.env.MIRA_TELEGRAM_BOT_TOKEN && process.env.MIRA_TELEGRAM_CHAT_ID) });
  }
  if (request.method !== 'POST') return reply({ error: 'Метод не поддерживается.' }, 405);
  if (!sameOrigin(request)) return reply({ error: 'Недопустимый источник запроса.' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return reply({ error: 'Ожидается JSON.' }, 415);
  }
  if (Number(request.headers.get('content-length')) > 8000) return reply({ error: 'Слишком длинное обращение.' }, 413);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return reply({ error: 'Слишком длинное обращение.' }, 413);
    data = JSON.parse(raw);
  } catch { return reply({ error: 'Не удалось прочитать обращение.' }, 400); }
  // A visitor's explicit confirmation is mandatory; never send data on chat initialization.
  if (!data || data.consent !== true) return reply({ error: 'Подтвердите согласие на передачу обращения.' }, 400);
  if (data.website) return reply({ delivered: false }, 200); // invisible honeypot
  const task = typeof data.task === 'string' ? data.task.trim() : '';
  const original = typeof data.original === 'string' ? data.original.trim() : '';
  const contact = typeof data.contact === 'string' ? data.contact.trim() : '';
  if (task.length < 12 || task.length > 1900 || original.length < 8 || original.length > 1900 || contact.length < 5 || contact.length > 180) {
    return reply({ error: 'Опишите задачу подробнее или немного сократите текст.' }, 400);
  }
  const token = process.env.MIRA_TELEGRAM_BOT_TOKEN;
  const chat = process.env.MIRA_TELEGRAM_CHAT_ID;
  if (!token || !chat || !/^-?\d{5,22}$/.test(chat)) {
    return reply({ error: 'Приём заявок в Telegram пока не подключён. Можно отправить письмо.' }, 503);
  }
  const message = [
    '📨 Новое обращение через MIRA',
    '🌐 mirvixai.com',
    '',
    '📝 Задача для специалиста:',
    task,
    '',
    '💬 Исходные слова клиента:',
    original,
    '',
    '📞 Предпочтительный способ связи и контакт:',
    contact,
    '',
    '🕒 ' + new Date().toISOString() + ' (UTC)',
  ].join('\n');
  if (message.length > 4096) return reply({ error: 'Обращение слишком длинное для Telegram.' }, 413);
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      return reply({ error: 'Telegram не подтвердил доставку. Попробуйте ещё раз или отправьте письмо.' }, 502);
    }
    return reply({ delivered: true });
  } catch {
    return reply({ error: 'Не удалось доставить обращение в Telegram. Попробуйте ещё раз или отправьте письмо.' }, 502);
  }
}

export const config = {
  path: '/api/mira-submit',
  rateLimit: { windowLimit: 3, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};