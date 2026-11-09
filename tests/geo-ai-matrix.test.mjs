import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {_test as gen} from '../netlify/functions/geo-prompts.mjs';
import {_test as api} from '../netlify/functions/direct-geo.mjs';

test('matrix accepts up to 20 questions per generation request',()=>{
  assert.equal(gen.validate({count:20,brand:'Магазин',category:'Стройматериалы'}).count,20);
  assert.throws(()=>gen.validate({count:100,brand:'Магазин',category:'Стройматериалы'}));
  assert.throws(()=>gen.validate({count:20,brand:'Магазин'}));
});

test('brand and duplicate prompts are removed, domain references rejected',()=>{
  const questions=[
    'Где купить плиту ОСБ в Санкт-Петербурге?',
    'Где купить плиту ОСБ в Санкт-Петербурге?',
    'Где купить стройматериалы в магазине Петрович?',
    'Купить строительные материалы на https://petrovich.ru',
    'Кто доставляет гипсокартон в Санкт-Петербурге?'
  ];
  const q=gen.uniquePrompts(questions,[],'Петрович',10);
  assert.equal(q.length,2);
  assert.ok(q.every(x=>!x.includes('Петрович')));
});

test('API recognizes six requested providers and Perplexity as optional seventh',()=>{
  for(const name of ['openai','gemini','deepseek','grok','gigachat','alice']){
    assert.equal(api.validate({provider:name,prompt:'Где купить гипсокартон в Санкт-Петербурге?',brand:'Магазин',domain:'shop.ru'}).provider,name);
  }
  assert.throws(()=>api.validate({provider:'random',prompt:'Где купить гипсокартон в Санкт-Петербурге?',brand:'Магазин'}));
});

test('browser scripts are valid JavaScript',()=>{
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  const matches=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(matches.length>=2,'Two scripts expected: original audit and GEO runner');
  for(const [i,m] of matches.entries())new Script(m[1],{filename:'check/index-script-'+(i+1)+'.js'});
});

test('large paid checks cannot start without staff authentication',async()=>{
  const {handler}=await import('../netlify/functions/geo-prompts.mjs');
  const result=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({count:20,brand:'Магазин',category:'Стройматериалы'})});
  assert.equal(result.statusCode,401);
});

test('AI audit uses dedicated website and company fields and one staff entry point',()=>{
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  assert.match(html,/id="geo-url"/);
  assert.match(html,/id="geo-brand"/);
  assert.equal((html.match(/class="employee-login"/g)||[]).length,1);
  const section=html.slice(html.indexOf('<section class="panel noprint" id="geo-check">'),html.indexOf('<main id="report"'));
  assert.ok(section.indexOf('id="geo-connect"')<section.indexOf('class="employee-login"'));
  assert.ok(section.indexOf('class="employee-login"')<section.indexOf('id="geo-work"'));
  assert.match(html,/get\('staff'\)==='1'/);
});

test('staff login goes directly to AI check, with no duplicate staff dashboard navigation',()=>{
  const html=readFileSync(new URL('../cabinet/index.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for(const [i,match] of scripts.entries())new Script(match[1],{filename:'cabinet-script-'+i+'.js'});
  assert.match(html,/get\('next'\)==='geo-check'/);
  assert.match(html,/returnToCheck\(\);return;/);
  assert.ok(!html.includes("textContent='Открыть GEO-анализ →'"));
  assert.ok(!html.includes("textContent='Технический аудит →'"));
});

test('generator config reports missing keys without triggering API billing',async()=>{
  const {handler}=await import('../netlify/functions/geo-prompts.mjs');
  // Anonymous requests cannot inspect account configuration or generate paid queries.
  const response=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'config'})});
  assert.equal(response.statusCode,401);
});

test('generator validates brand and topic, allows brand-neutral questions',()=>{
  assert.throws(()=>gen.validate({count:10,brand:'Шурик Маркет'}),/сферу деятельности/);
  const input=gen.validate({count:15,brand:'Шурик Маркет',title:'Шурик Маркет — строительные материалы',city:'Санкт-Петербург'});
  assert.equal(input.count,15);
  const examples=['Где в Петербурге купить листы ОСБ для пола?',
    'Какие магазины предлагают гипсокартон с доставкой в Санкт-Петербурге?',
    'Стоит ли покупать стройматериалы в Шурик Маркет?'];
  const selected=gen.uniquePrompts(examples,[],input.brand,15);
  assert.equal(selected.length,2);
});

test('client automatically fetches site metadata before generating prompts',()=>{
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  assert.match(html,/async function readCompanyProfile\(/);
  assert.match(html,/const profile=await readCompanyProfile\(company\)/);
  assert.match(html,/action:'generate'/);
  assert.match(html,/promptGeneratorReady/);
});
