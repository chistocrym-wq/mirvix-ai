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

test('API recognizes all seven requested AI providers including Perplexity',()=>{
  for(const name of ['openai','gemini','deepseek','grok','gigachat','alice','perplexity']){
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
  const section=html.slice(html.indexOf('<section class="panel noprint" id="geo-check"'),html.indexOf('<main id="report"'));
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
  const generator=readFileSync(new URL('../check/prompt-generator.js',import.meta.url),'utf8');
  assert.match(generator,/async function profileFromSite\(/);
  assert.match(generator,/context=await profileFromSite\(context\)/);
  assert.match(generator,/action:'generate'/);
  assert.match(html,/prompt-generator\.js/);
});


test('buyer prompt context includes verified specialities and mixed question lengths',()=>{
  const input=gen.validate({count:15,brand:'Клиника Север',category:'медицинская клиника',
    city:'Санкт-Петербург',serviceHeadings:['Гинекология','Кардиология'],
    siteExcerpt:'Приём гинеколога и кардиолога в Санкт-Петербурге.'});
  assert.deepEqual(input.serviceHeadings,['Гинекология','Кардиология']);
  assert.match(input.siteExcerpt,/гинеколога/);
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  assert.match(html,/serviceHeadings/);
  assert.match(html,/siteExcerpt/);
  assert.match(html,/optional-checks/);
  assert.match(html,/d\.optionalChecks/);
});

test('single click runs all requests, supports stop/resume and renders site candidates',()=>{
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  assert.match(html,/Запустить проверку по всем запросам/);
  assert.match(html,/while\(results\.length<planned\.length&&!stopRequested\)/);
  assert.match(html,/id="geo-stop"/);
  assert.match(html,/id="geo-site-rows"/);
  assert.match(html,/id="geo-pdf-site-rows"/);
  assert.match(html,/competingSites:websiteCandidates\(\)/);
  assert.match(html,/competitor-sites\.js/);
  assert.ok(!html.includes('Запустить следующие 20 проверок'));
});
test('website competitors are deduplicated, exclude owned domain and separate citations',async()=>{
  const {runInNewContext}=await import('node:vm');
  const js=readFileSync(new URL('../check/competitor-sites.js',import.meta.url),'utf8');
  const scope={URL};
  runInNewContext(js,scope);
  const engine=scope.MIRVIXCompetingSites;
  assert.ok(engine);
  const sample=[
    {provider:'openai',prompt:'Где найти врача?',answer:'Советую clinic-a.ru и clinic-b.ru',brandMention:false,
      sources:[{url:'https://clinic-b.ru/doctors'},{url:'https://prodoctorov.ru/review'},{url:'https://myclinic.ru/home'}]},
    {provider:'gemini',prompt:'Где найти врача?',answer:'Выбирайте https://clinic-a.ru/',brandMention:false,
      sources:[{url:'https://clinic-c.ru/doctors'}]},
    {provider:'grok',prompt:'Где найти врача?',answer:'Выбирайте MyClinic',brandMention:true,
      sources:[{url:'https://clinic-a.ru/'}]},
    {provider:'gemini',prompt:'Где нужна консультация?',error:'unauthorized'}
  ];
  const rows=engine.aggregate(sample,'https://myclinic.ru/',true);
  assert.deepEqual(Array.from(rows.map(x=>x.domain)).sort(),['clinic-a.ru','clinic-b.ru','clinic-c.ru']);
  const a=rows.find(x=>x.domain==='clinic-a.ru');
  assert.equal(a.answerCount,2);
  assert.equal(a.systems.length,2);
  assert.equal(rows.find(x=>x.domain==='clinic-c.ru').sourceCount,1);
  assert.ok(!rows.some(x=>x.domain==='myclinic.ru'||x.domain==='prodoctorov.ru'));
});


test('Perplexity is visible as seventh UI model and uses Agent API with grounded citations',()=>{
  const html=readFileSync(new URL('../check/index.html',import.meta.url),'utf8');
  assert.match(html,/id:'perplexity',name:'Perplexity'/);
  assert.match(html,/Проверить подключения семи ИИ/);
  const backend=readFileSync(new URL('../netlify/functions/direct-geo.mjs',import.meta.url),'utf8');
  assert.match(backend,/PERPLEXITY_API_KEY/);
  assert.match(backend,/api\.perplexity\.ai\/v1\/agent/);
  assert.match(backend,/preset: 'fast'/);
  assert.match(backend,/entry\.type === 'search_results'/);
  assert.ok(!backend.includes("https://api.perplexity.ai/v1/sonar"));
});


test('provider errors distinguish billing, keys, permissions, bad model and quota',()=>{
  const render=api.providerError;
  assert.match(render(402,{error:{code:'insufficient_balance',message:'Balance too low'}}),/Недостаточно средств/);
  assert.match(render(401,{error:{message:'Bad key'}}),/Неверный или отозванный API-ключ/);
  assert.match(render(403,{error:{message:'Tool restricted'}}),/Нет доступа/);
  assert.match(render(404,{error:{message:'Unknown model'}}),/Модель либо API-адрес/);
  assert.match(render(429,{error:{message:'Rate limit exceeded'}}),/Не обязательно проблема с деньгами/);
  assert.match(render(400,{error:{message:'Invalid tool type'}}),/Invalid tool type/);
});

test('provider errors do not echo long credential-like values',()=>{
  const fake='sk-'+'x'.repeat(60);
  const shown=api.providerError(401,{error:{message:'Authorization Bearer '+fake}});
  assert.doesNotMatch(shown,/sk-x{20}/);
  assert.match(shown,/\[скрыто\]/);
});
