import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {_test as api} from '../netlify/functions/geo-prompts.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('generation form and 5, 10 and 15 prompts visible before API connection',()=>{
  const html=read('check/index.html');
  assert.match(html,/<div id="geo-work">/);
  assert.doesNotMatch(html,/<div id="geo-work" hidden>/);
  for(const count of [5,10,15,30,50,70,100])
    assert.match(html,new RegExp('<option value="'+count+'">'+count+' запросов</option>'));
  assert.match(html,/id="geo-gen-diagnostic" role="status" aria-live="polite"/);
  assert.match(html,/<script defer src="\/check\/prompt-generator\.js"><\/script>/);
  assert.doesNotMatch(html,/\$\('geo-generate'\)\.onclick=/);
});

test('standalone generator script has a real click listener and immediate feedback',()=>{
  const js=read('check/prompt-generator.js');
  new Script(js,{filename:'prompt-generator.js'});
  assert.match(js,/btn\.addEventListener\('click',createQuestions\)/);
  assert.match(js,/report\('Кнопка работает\./);
  assert.doesNotMatch(js,/\bconfirm\s*\(/);
  assert.match(js,/await post\('geo-prompts',\{action:'config'\}/);
  assert.match(js,/action:'generate'/);
  assert.match(js,/textarea\.dispatchEvent\(new Event\('input'/);
  assert.match(js,/API генерации недоступен/);
});

test('local 5, 10, 15 preview fallback does not pretend to be an AI response',()=>{
  const js=read('check/prompt-generator.js');
  assert.match(js,/шаблонных вопросов БЕЗ ИИ/);
  assert.match(js,/if\(goal<=15\)/);
  assert.match(js,/localQuestions\(company,goal\)/);
  assert.match(js,/return templates\.slice\(0,Math\.max\(0,Math\.min\(15/);
});

test('question generator backend allows small request batches and rejects oversized ones',()=>{
  for(const count of [5,10,15])assert.equal(api.validate({count,brand:'Клиника',category:'Медицинские услуги'}).count,count);
  assert.throws(()=>api.validate({count:21,brand:'Клиника',category:'Медицинские услуги'}));
});
