import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const COOKIE_NAME = '__Host-mirvix_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function secret() {
  const value = process.env.MIRVIX_CABINET_SESSION_SECRET || '';
  return value.length >= 32 ? value : '';
}
export function rolePassword(role) {
  if (role === 'staff') return process.env.MIRVIX_AUDIT_PASSWORD || '';
  if (role === 'partner') return process.env.MIRVIX_PARTNER_PASSWORD || '';
  return '';
}
export function passwordEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' ||
      b.length < 12 || Buffer.byteLength(a) > 1024 || Buffer.byteLength(b) > 1024) return false;
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}
function fingerprint(role) {
  return createHash('sha256').update(rolePassword(role)).digest('hex').slice(0, 20);
}
function signature(data) {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}
export function createSession(role) {
  if (!secret() || rolePassword(role).length < 12) throw new Error('Cabinet not configured');
  const data = Buffer.from(JSON.stringify({
    version: 1,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    passwordVersion: fingerprint(role),
    nonce: randomBytes(12).toString('hex')
  }), 'utf8').toString('base64url');
  return data + '.' + signature(data);
}
function getCookie(headers) {
  const cookies = headers?.cookie || headers?.Cookie || '';
  if (typeof cookies !== 'string') return '';
  for (const part of cookies.split(';')) {
    const piece = part.trim();
    const prefix = COOKIE_NAME + '=';
    if (piece.startsWith(prefix)) return piece.slice(prefix.length);
  }
  return '';
}
export function sessionRole(headers) {
  if (!secret()) return null;
  const token = getCookie(headers);
  if (!token || token.length > 2500) return null;
  const chunks = token.split('.');
  if (chunks.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(chunks[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(chunks[1])) return null;
  const expected = signature(chunks[0]);
  if (expected.length !== chunks[1].length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(chunks[1]))) return null;
  try {
    const item = JSON.parse(Buffer.from(chunks[0], 'base64url').toString('utf8'));
    if (item.version !== 1 || !['staff', 'partner'].includes(item.role) ||
        typeof item.exp !== 'number' || item.exp <= Date.now() / 1000 ||
        item.exp > Date.now() / 1000 + SESSION_TTL_SECONDS + 90 ||
        item.passwordVersion !== fingerprint(item.role) ||
        rolePassword(item.role).length < 12) return null;
    return item.role;
  } catch { return null; }
}
export function requestIsSameOrigin(event) {
  const headers = event?.headers || {};
  const token = headers['x-mirvix-cabinet'] || headers['X-Mirvix-Cabinet'];
  if (token !== '1') return false;
  const origin = headers.origin || headers.Origin;
  if (origin) {
    try {
      const incoming = new URL(origin);
      const host = headers.host || headers.Host;
      if (incoming.protocol !== 'https:' || !host || incoming.host !== host) return false;
    } catch { return false; }
  }
  return true;
}
export function isStaffRequest(event) {
  return requestIsSameOrigin(event) && sessionRole(event.headers) === 'staff';
}
export function sessionCookie(token) {
  return COOKIE_NAME + '=' + token + '; Max-Age=' + SESSION_TTL_SECONDS +
    '; Path=/; HttpOnly; Secure; SameSite=Strict';
}
export function expiredCookie() {
  return COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict';
}
