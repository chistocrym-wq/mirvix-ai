import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miraSuggestedLinks } from '../netlify/functions/mira-chat.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('MIRA offers precise same-site deep links for contacts and GEO pricing questions',()=>{
  assert.deepEqual(miraSuggestedLinks('Где ваши контакты и номер телефона?').map(x=>x.href),['/legal/contacts/']);
  assert.deepEqual(miraSuggestedLinks('Какие тарифы и стоимость GEO?').map(x=>x.href),['/tariffs/#geo']);
  assert.deepEqual(miraSuggestedLinks('Сколько стоит сопровождение?').map(x=>x.href),['/tariffs/#geo','/tariffs/#support']);
  assert.deepEqual(miraSuggestedLinks('Как вы обрабатываете персональные данные?').map(x=>x.href),['/legal/privacy/']);
});
test('MIRA dialog has separate consent before AI and during sending lead',()=>{
  const html=read('index.html');
  const js=read('assets/mira-widget.js');
  assert.match(html,/data-mira="welcome"/);
  assert.match(html,/data-mira="allow-ai"/);
  assert.match(html,/data-mira="deny-ai"/);
  assert.match(html,/data-mira="ai-settings"/);
  assert.match(html,/data-mira="delivery-consent"/);
  assert.doesNotMatch(html,/class="mira-foot"/);
  assert.doesNotMatch(html,/class="mira-consent"/);
  assert.match(js,/mirvix_mira_ai_choice_v1/);
  assert.match(js,/getItem\(consentKey\)/);
  assert.match(js,/setItem\(consentKey, choice\)/);
  assert.match(js,/consentChoice === 'allowed'/);
  assert.match(js,/destinationMap/);
  assert.match(js,/Object\.prototype\.hasOwnProperty\.call\(destinationMap,x\)/);
  assert.match(js,/attachSiteLinks\(pending/);
});
test('tariff deliverables list original amounts, baseline, GEO-passport and reconciliation',()=>{
  const t=read('tariffs/index.html');
  for(const price of ['50 000 ₽','89 000 ₽','129 000 ₽','259 000 ₽','45 000 ₽','65 000 ₽','85 000 ₽'])
    assert.ok(t.includes(price),'Missing price '+price);
  for(const phrase of ['GEO-паспорт','Замер «до»','Сверка «после»','до <b>5</b> конкурентов',
    'целевых запросов','не гарантируем рекомендации','30/60/90'])
    assert.ok(t.includes(phrase),'Missing phrase '+phrase);
});
test('binary ocean stays distributed throughout the video hero',()=>{
  const page=read('index.html');
  const codeCount=(page.match(/class="mirvix-code-fragment"/g)||[]).length;
  assert.ok(codeCount>=115,'Too few fragments: '+codeCount);
  assert.match(page,/--fy:9\d\.\d%;--fs:/);
  assert.match(page,/--ft:[\d.]+s/);
  const css=read('assets/ocean-premium.css');
  assert.match(css,/animation:mirvix-binary-pulse/);
});
