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
