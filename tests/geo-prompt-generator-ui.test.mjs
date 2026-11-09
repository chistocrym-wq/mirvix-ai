import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
test('GEO prompt generator button has a separate handler, visible diagnostics and safe retry',()=>{
 const html=read('check/index.html');
 const js=read('check/prompt-generator.js');
 assert.match(html,/id="geo-gen-diagnostic" role="status"/);
 assert.match(html,/<div id="geo-work">/);
 assert.match(html,/src="\/check\/prompt-generator\.js"/);
 assert.match(js,/btn\.addEventListener\('click',createQuestions\)/);
 assert.match(js,/note\.textContent=message/);
 assert.match(js,/const previous=textarea\.value/);
 assert.match(js,/textarea\.value=previous/);
 assert.match(js,/OPENAI_API_KEY \/ GEMINI_API_KEY|нет OPENAI_API_KEY|config\.configured/);
 for(const [i,match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries()){
   if(match[1].trim())new Script(match[1],{filename:'geo-script-'+i});
 }
 new Script(js,{filename:'geo-prompt-generator.js'});
});
test('generator uses active Gemini model and reports API errors',()=>{
 const server=read('netlify/functions/geo-prompts.mjs');
 assert.match(server,/gemini-3\.5-flash-lite/);
 assert.doesNotMatch(server,/gemini-2\.5-flash/);
 assert.match(server,/max_output_tokens:4500/);
 assert.match(server,/Functions/);
});
