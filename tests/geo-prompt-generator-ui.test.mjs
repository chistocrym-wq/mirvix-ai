import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
test('GEO prompt generator button has visible diagnostics and is reachable after staff check',()=>{
 const s=read('check/index.html');
 assert.match(s,/id="geo-gen-diagnostic" role="status"/);
 assert.match(s,/\$\('geo-gen-diagnostic'\)\.textContent=message/);
 assert.match(s,/originalQuestions=\$\('geo-questions'\)\.value/);
 assert.match(s,/if\(!questions\.length&&originalQuestions\.trim\(\)\)/);
 assert.match(s,/\$\('geo-generate'\)\.disabled=false/);
 assert.match(s,/OPENAI_API_KEY \/ GEMINI_API_KEY/);
 for(const [i,match] of [...s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries()){
   if(match[1].trim())new Script(match[1],{filename:'geo-script-'+i});
 }
});
test('generator uses active Gemini model and reports API errors',()=>{
 const server=read('netlify/functions/geo-prompts.mjs');
 assert.match(server,/gemini-3\.5-flash-lite/);
 assert.doesNotMatch(server,/gemini-2\.5-flash/);
 assert.match(server,/max_output_tokens:4500/);
 assert.match(server,/Functions/);
});
