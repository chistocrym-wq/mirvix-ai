import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('platform keeps original two user screenshots and does not embed generated mockup',()=>{
 const html=read('index.html');
 assert.match(html,/id="platform"/);
 assert.match(html,/2aec05e5-35d9-4913-81e5-f02689a5a7ca\.png/);
 assert.match(html,/45efc346-f1a8-4d9e-b794-7dbf2f28b291\.png/);
 assert.equal((html.match(/class="mirvix-platform-shot"/g)||[]).length,2);
 assert.match(html,/Платформа ещё разрабатывается/);
 assert.match(html,/не гарантирует/);
});
test('tariffs page is separate and both menus link there',()=>{
 const home=read('index.html'), tariffs=read('tariffs/index.html');
 assert.ok((home.match(/href="\/tariffs\/"/g)||[]).length>=3);
 assert.ok(home.indexOf('id="platform"')>0);
 assert.ok(!home.includes('id="geo-packages"'));
 assert.match(tariffs,/id="geo"/);
 assert.match(tariffs,/id="support"/);
 assert.equal((tariffs.match(/class="plan(?: featured)?"/g)||[]).length,8);
});
test('correct prices are displayed',()=>{
 const page=read('tariffs/index.html');
 for(const price of ['50 000 ₽','89 000 ₽','129 000 ₽','259 000 ₽',
                       '45 000 ₽','65 000 ₽','85 000 ₽','0 ₽']){
  assert.ok(page.includes(price),'Missing tariff '+price);
 }
 assert.match(page,/сопровождение необязательно/i);
 assert.match(page,/не гарантируются/);
 assert.match(page,/Самостоятельно/);
});
test('tariffs is in sitemap and accessible to search engines',()=>{
 const sitemap=read('sitemap.xml');
 assert.match(sitemap,/https:\/\/mirvixai\.com\/tariffs\//);
 const page=read('tariffs/index.html');
 assert.match(page,/<meta name="viewport"/);
 assert.match(page,/<link rel="canonical" href="https:\/\/mirvixai\.com\/tariffs\/">/);
 assert.match(page,/@media\(max-width:690px\)/);
});
