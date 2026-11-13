import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { _test as leads } from '../netlify/functions/ai-visibility-request.mjs';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('public AI lead form rejects WhatsApp and accepts email and Telegram',()=>{
  const sample={company:'Пример Клиника',site:'https://clinic.example.org',category:'Многопрофильная клиника',
    name:'Тестовый посетитель',contact:'test@example.org',channel:'email',consent:true};
  assert.equal(leads.prepare(sample).channel,'email');
  assert.equal(leads.prepare({...sample,channel:'telegram',contact:'@exampleclinic'}).channel,'telegram');
  assert.throws(()=>leads.prepare({...sample,channel:'whatsapp',contact:'+79000000000'}),/способ/);
});
test('free check uses unique request id and distinguishes stored vs notified',()=>{
  const s=read('check/free-ai-request.js');
  assert.match(s,/requestId/);
  assert.match(s,/pendingRequestId/);
  assert.match(s,/notified\s*===\s*true/);
  const api=read('netlify/functions/ai-visibility-request.mjs');
  assert.match(api,/await saveLead\(leadId,prepared\)/);
  assert.match(api,/notification:'pending'/);
  assert.match(api,/isStaffRequest/);
});
test('contact links and forms omit WhatsApp; no SEO ranking promises on home',()=>{
  for(const file of ['index.html','check/index.html','tools/index.html','legal/contacts/index.html']){
    const s=read(file);
    assert.doesNotMatch(s,/(?:wa\.me\/|value="whatsapp"|>WhatsApp\s*<)/i);
  }
  const home=read('index.html');
  assert.match(home,/усилить видимость в нейросетях и ИИ-поиске/);
  assert.doesNotMatch(home,/усиливать видимость/);
});
test('turquoise ocean keeps moving after intro unless reduced motion is requested',()=>{
  const home=read('index.html');
  assert.match(home,/background:#0b939a/);
  const mark=home.indexOf('var finish=function()');
  const end=home.indexOf('var start=function()',mark);
  assert.ok(mark>=0&&end>mark);
  assert.doesNotMatch(home.slice(mark,end),/video\.pause\(\)/);
  assert.match(home.slice(end,end+700),/video\.play\(\)/);
});
test('voice fallback endpoint and privacy contract exist',()=>{
  const s=read('assets/mira-widget.js');
  assert.match(s,/mediaDevices\.getUserMedia/);
  assert.match(s,/\/api\/mira-transcribe/);
  assert.match(s,/\/api\/mira-chat/);
  assert.match(s,/isBusinessTask/);
  const ep=read('netlify/functions/mira-transcribe.mjs');
  assert.match(ep,/consent/); assert.match(ep,/\/v1\/audio\/transcriptions/);
  const legal=read('legal/privacy/index.html');
  assert.match(legal,/голосовые сообщения/);
  const inbox=read('leads/index.html');
  for(const sc of [...inbox.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)])
    new Script(sc[1]);
});
