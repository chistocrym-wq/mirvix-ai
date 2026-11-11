import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {TOOL_PRICES,packageForRivals,toolsConfigured,paymentsConfigured,
  identify,sameOrigin} from '../netlify/lib/tools-access.mjs';
import {_test as payment} from '../netlify/functions/tools-checkout.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('one-off packages are exactly 1, 2-3 and 4-5 rivals',()=>{
 assert.equal(packageForRivals(1),'competitor_1');
 assert.equal(packageForRivals(2),'competitor_3');
 assert.equal(packageForRivals(3),'competitor_3');
 assert.equal(packageForRivals(5),'competitor_5');
 assert.equal(packageForRivals(0),null);
 assert.equal(packageForRivals(6),null);
 assert.equal(TOOL_PRICES.competitor_1.rub,490);
 assert.equal(TOOL_PRICES.competitor_3.rub,990);
 assert.equal(TOOL_PRICES.competitor_5.rub,1990);
});
test('payment is fail-closed without live merchant credentials and fiscal receipts',()=>{
 const variables=['MIRVIX_TOOLS_SESSION_SECRET','MIRVIX_CABINET_SESSION_SECRET',
  'MIRVIX_TOOLS_PAYMENTS_ENABLED','YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY','MIRVIX_TOOLS_VAT_CODE'];
 const previous=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
 try{
  process.env.MIRVIX_TOOLS_SESSION_SECRET='x'.repeat(40);
  for(const variable of variables.slice(2))delete process.env[variable];
  assert.equal(toolsConfigured(),true);
  assert.equal(paymentsConfigured(),false);
 }finally{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('visitor sessions use secure signed cookies, not unsigned browser claims',()=>{
 const old=process.env.MIRVIX_TOOLS_SESSION_SECRET;
 process.env.MIRVIX_TOOLS_SESSION_SECRET='test-secret-at-least-thirty-two-characters-long';
 try{
  const fresh=identify({headers:{}});
  assert.match(fresh.cookie,/HttpOnly; Path=\/; SameSite=Lax/);
  const second=identify({headers:{cookie:fresh.cookie.split(';')[0]}});
  assert.equal(second.cookie,null);
  assert.equal(second.id,fresh.id);
  const tampered=identify({headers:{cookie:fresh.cookie.split(';')[0].replace(/.$/,'x')}});
  assert.notEqual(tampered.id,fresh.id);
 }finally{if(old===undefined)delete process.env.MIRVIX_TOOLS_SESSION_SECRET;else process.env.MIRVIX_TOOLS_SESSION_SECRET=old;}
});
test('only same-origin HTTPS website requests can consume previews or buy',()=>{
 assert.equal(sameOrigin({headers:{origin:'https://mirvixai.com',host:'mirvixai.com'}}),true);
 assert.equal(sameOrigin({headers:{origin:'https://evil.example',host:'mirvixai.com'}}),false);
 assert.equal(sameOrigin({headers:{origin:'http://mirvixai.com',host:'mirvixai.com'}}),false);
 assert.equal(sameOrigin({headers:{host:'mirvixai.com'}}),false);
});
test('payment status must be tied to a browser, verified server-side and prices cannot be modified by client',()=>{
 const checkout=read('netlify/functions/tools-checkout.mjs');
 const gate=read('netlify/functions/competitor-products.mjs');
 assert.match(checkout,/verifyPayment\(order\)/);
 assert.match(checkout,/Idempotence-Key/);
 assert.match(checkout,/receipt:/);
 assert.match(checkout,/return_url:'https:\/\/mirvixai\.com\/tools\//);
 assert.match(gate,/claimPreview\(visitor\.id,'competitor-products'\)/);
 assert.match(gate,/mode==='full'/);
 assert.match(gate,/await verifyPayment\(order\)/);
 assert.match(gate,/await markConsumed\(order\)/);
 assert.match(gate,/comparisons:preview\?\[\]:comparisons/);
 assert.match(gate,/specifications:\{\}/);
 assert.equal(payment.validEmail('user@example.com'),true);
 assert.equal(payment.validEmail('bad-email'),false);
});
test('public tools no longer offer direct checks, payment, preview or price list',()=>{
 const html=read('tools/index.html');
 const js=read('tools/request.js');
 new Script(js,{filename:'tools/request.js'});
 assert.match(html,/Инструменты/);
 assert.match(html,/tools-request-form/);
 assert.match(html,/Домен \/ ссылка на сайт конкурента/);
 assert.doesNotMatch(html,/Купить полный отчёт|490 ₽|id="compare-form"/);
 assert.doesNotMatch(html,/geo-tools\.js/);
 assert.match(js,/api\/ai-visibility-request/);
 assert.match(read('netlify/functions/tools-checkout.mjs'),/Самостоятельная покупка отчёта отключена/);
 assert.match(read('netlify/functions/competitor-products.mjs'),/Самостоятельное сравнение больше не доступно/);
});
