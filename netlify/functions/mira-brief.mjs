// MIRA: rephrase a visitor's business task into a faithful, complete specialist brief.
// Personal contacts must be handled locally and are rejected here.
const MODEL = process.env.MIRA_CHAT_MODEL || 'gpt-4.1-mini';
const INSTRUCTION = [
  'Ты MIRA, редактор обращений для специалистов MIRVIX AI.',
  'Тебе прислали слова клиента о том, какую задачу для бизнеса он хочет решить.',
  'Напиши ПОЛНУЮ связную формулировку его обращения на русском языке.',
  'Сохрани все конкретные пожелания, функции, условия, ограничения и детали.',
  'Ничего не придумывай: не добавляй цены, сроки, обещания, контакты и несуществующие требования.',
  'Не задавай никаких вопросов, не начинай с приветствия, не отвечай просто "да" или "нет".',
  'Оформи запрос как обращение к специалисту: цель, конкретные действия, важные ограничения и пожелания — строго из слов клиента.',
  'Сформулируй 2–5 содержательных предложений; если пожеланий много, используй два абзаца, сохрани каждую существенную деталь.',
  'Если второе сообщение уточняет или исправляет первое, учти исправление как более актуальное и не повторяй противоречия.',
  'Начни с "Задача: " и напиши один или несколько понятных абзацев.',
  'Если сообщение короткое, не растягивай его. Не используй markdown и списки.',
].join(' ');
const CONTACTS = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d\s()\-]{8,}\d|(?:https?:\/\/)?t\.me\/[\w+\-]{4,}|@[a-z\d_]{5,})/i;
const output = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
export default async function handler(request) {
  if (request.method !== 'POST') return output({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  try {
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return output({ error: 'Запрос отклонён.' }, 403);
  } catch { return output({ error: 'Запрос отклонён.' }, 403); }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return output({ error: 'Ожидается JSON.' }, 415);
  if (Number(request.headers.get('content-length')) > 6500) return output({ error: 'Слишком длинный текст.' }, 413);
  let body;
  try { const raw = await request.text(); if (raw.length > 6500) return output({ error: 'Слишком длинный текст.' }, 413); body = JSON.parse(raw); }
  catch { return output({ error: 'Некорректные данные.' }, 400); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (body?.consent !== true || text.length < 4 || text.length > 2000 || CONTACTS.test(text)) {
    return output({ error: 'Разрешите обработку текста и не включайте личные контакты.' }, 400);
  }
  const token = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL;
  if (!token || !base) return output({ error: 'ИИ-формулировка временно недоступна.' }, 503);
  let url;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== 'https:') throw Error('Expected HTTPS');
    url = parsed.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/chat/completions';
  } catch { return output({ error: 'ИИ-формулировка временно недоступна.' }, 503); }
  try {
    const result = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.15, max_tokens: 750, messages: [
        { role: 'system', content: INSTRUCTION }, { role: 'user', content: text },
      ] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!result.ok) return output({ error: 'Формулировка временно недоступна.' }, 503);
    const json = await result.json();
    const formulated = json?.choices?.[0]?.message?.content;
    if (typeof formulated !== 'string' || formulated.trim().length < 8) return output({ error: 'Пустой ответ ИИ.' }, 503);
    return output({ formulated: formulated.trim().slice(0, 1900) });
  } catch { return output({ error: 'ИИ-формулировка временно недоступна.' }, 503); }
}
export const config = {
  path: '/api/mira-brief',
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};