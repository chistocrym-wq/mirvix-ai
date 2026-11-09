import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const root=new URL('../',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root),'utf8');
const pages=[
  'index.html','ai-search/index.html','audit/index.html','cabinet/index.html',
  'check/index.html','geo-live/index.html','geo/index.html',
  'legal/contacts/index.html','legal/privacy/index.html',
  'legal/terms/index.html','tariffs/index.html','useful/index.html',
  'useful/ai-visibility-not-one-score/index.html',
  'useful/geo-checklist-30-days/index.html',
  'useful/geo-report-metrics/index.html'
];

test('Metrika loader included exactly once on all 15 public and restricted HTML pages',()=>{
  for(const path of pages){
    const html=read(path);
    assert.equal((html.match(/src="\/assets\/mirvix-metrika\.js"/g)||[]).length,1,path);
    assert.equal((html.match(/114153852/g)||[]).length,0,'no inlined counter in '+path);
    assert.match(html,/<\/head>/i);
  }
});

test('single shared Metrika script uses supplied counter and source hosts without invented referral attribution',()=>{
  const js=read('assets/mirvix-metrika.js');
  new Script(js,{filename:'mirvix-metrika.js'});
  assert.match(js,/const COUNTER_ID = 114153852/);
  assert.match(js,/mc\.webvisor\.org\/metrika\/tag_ww\.js\?id=/);
  for(const host of ['chatgpt.com','perplexity.ai','gemini.google.com','claude.ai','grok.com','chat.deepseek.com','giga.chat','alice.yandex.ru']){
    assert.ok(js.includes(host),host);
  }
  assert.match(js,/document\.referrer/);
  assert.match(js,/utm_source/);
  assert.match(js,/mirvix_ai_source/);
  assert.match(js,/mirvix_ai_attribution/);
  assert.match(js,/mirvix_geo_check_open/);
  assert.match(js,/mirvix_tariffs_open/);
  assert.match(js,/mirvix_form_submit_attempt/);
});

test('tracking is opt-in and Webvisor cannot record cabinet or GEO-audit pages',()=>{
  const js=read('assets/mirvix-metrika.js');
  assert.match(js,/if \(choice === 'accepted'\) initCounter\(\)/);
  assert.match(js,/else if \(choice !== 'declined'\) showConsent\(\)/);
  assert.match(js,/webvisor: !isSensitivePage/);
  assert.match(js,/clickmap: !isSensitivePage/);
  assert.match(js,/trackLinks: !isSensitivePage/);
  assert.match(js,/const safeCurrentUrl = location\.origin \+ location\.pathname/);
  assert.match(js,/COOKIE_CHOICE/);
  assert.match(js,/Без аналитики/);
  assert.doesNotMatch(read('index.html'),/mc\.yandex\.ru\/watch\/114153852/);
});

test('privacy policy discloses Yandex tracking and allows reopening consent controls',()=>{
  const html=read('legal/privacy/index.html');
  assert.match(html,/Яндекс Метрика \(идентификатор счётчика 114153852\)/);
  assert.match(html,/после добровольного согласия/);
  assert.match(html,/Вебвизор/);
  assert.match(html,/id="mirvix-cookie-settings"/);
});

test('hidden PDF-only GEO report does not duplicate visible on-screen report',()=>{
  const html=read('check/index.html');
  assert.match(html,/#geo-pdf\{display:none\}/);
  assert.match(html,/@media print\{#geo-pdf:not\(\[hidden\]\)\{display:block\}\}/);
  assert.match(html,/id="geo-visual-report"/);
  assert.match(html,/id="geo-pdf" hidden/);
});
