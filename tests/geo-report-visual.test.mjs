import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const vm={};
runInNewContext(read('check/report-metrics.js'),vm);
const m=vm.MIRVIXReportMetrics;

test('percentages use successful answers as denominator, not failed API attempts',()=>{
  const results=[
    {provider:'openai',prompt:'A',answer:'Магазин Пример предлагает товары',brandMention:true,sourceMention:false,searchEvidence:true},
    {provider:'openai',prompt:'B',answer:'Другой магазин',brandMention:false,sourceMention:false,searchEvidence:true},
    {provider:'openai',prompt:'C',error:'quota exceeded'},
    {provider:'gemini',prompt:'A',answer:'Магазин Пример',brandMention:true,sourceMention:true,searchEvidence:true}
  ];
  const stat=m.calculate(results,'Магазин Пример',[],['openai','gemini']);
  assert.equal(stat.webAnswers,3);
  assert.equal(stat.webMentions,2);
  assert.equal(stat.mentionRate,67);
  assert.equal(stat.linkRate,33);
  assert.equal(stat.voiceShare,null);
  assert.equal(stat.providers[0].mentionRate,50);
  assert.equal(stat.providers[0].errors,1);
  assert.equal(stat.providers[1].mentionRate,100);
});

test('missing results and model-only GigaChat are not merged into web-search total',()=>{
  const results=[
    {provider:'gigachat',mode:'model-only',prompt:'A',answer:'Бренд есть',brandMention:true,sourceMention:false},
    {provider:'openai',mode:'web-grounded',prompt:'A',error:'error'},
    {provider:'gemini',mode:'web-grounded',prompt:'A',answer:'Ответ без упоминания',brandMention:false,sourceMention:false}
  ];
  const stat=m.calculate(results,'Бренд',[],['gigachat','openai','gemini']);
  assert.equal(stat.mentionRate,0);
  assert.equal(stat.webAnswers,1);
  assert.equal(stat.modelOnlyAnswers,1);
  const onlyGiga=m.calculate(results.slice(0,1),'Бренд',[],['gigachat']);
  assert.equal(onlyGiga.mentionRate,null);
});

test('voice share requires explicitly defined competition; early mention is not top-3 placement',()=>{
  const results=[
    {provider:'gemini',prompt:'A',answer:'Север Клиника рекомендуема',brandMention:true,sourceMention:false,competitorsMentioned:['Другая клиника']},
    {provider:'openai',prompt:'B',answer:'Другая клиника известна',brandMention:false,sourceMention:false,competitorsMentioned:['Другая клиника']}
  ];
  const stat=m.calculate(results,'Север Клиника',['Другая клиника'],['gemini','openai']);
  assert.equal(stat.voiceShare,33);
  assert.equal(stat.earlyRate,100);
  assert.equal(m.calculate(results,'Север Клиника',[],[]).voiceShare,null);
});

test('question by engine heatmap clearly distinguishes citations, mentions, no visibility, errors, pending',()=>{
  const results=[
    {provider:'openai',prompt:'q1',answer:'Магазин',brandMention:true,sourceMention:true},
    {provider:'gemini',prompt:'q1',answer:'Компания X',brandMention:false,sourceMention:false},
    {provider:'openai',prompt:'q2',error:'rate limit'}
  ];
  const rows=m.heatmap(results,['q1','q2'],['openai','gemini']);
  assert.equal(rows[0].cells[0].status,'link-and-brand');
  assert.equal(rows[0].cells[1].status,'absent');
  assert.equal(rows[1].cells[0].status,'error');
  assert.equal(rows[1].cells[1].status,'pending');
});

test('the report has live and print charts, honest no-data state, FAQ and original guides',()=>{
 const html=read('check/index.html');
 const articles=['ai-visibility-not-one-score','geo-report-metrics','geo-checklist-30-days'];
 assert.match(html,/id="geo-live-scorecards"/);
 assert.match(html,/id="geo-pdf-scorecards"/);
 assert.match(html,/id="geo-live-matrix"/);
 assert.match(html,/id="geo-pdf-matrix"/);
 assert.match(html,/id="faq"/);
 assert.match(html,/Реферальный трафик.*?null/);
 assert.match(html,/top-3|топ-3/i);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
 for(const [i,match] of scripts.entries()){
   if(match[1].trim())new Script(match[1],{filename:'check-inline-'+i});
 }
 const landing=read('useful/index.html'),main=read('index.html');
 assert.match(main,/href="\/useful\/"/);
 for(const slug of articles){
   assert.match(landing,new RegExp(slug));
   const page=read('useful/'+slug+'/index.html');
   assert.match(page,/propellernet\.co\.uk/);
   assert.match(page,/SUSO Digital/);
 }
});
