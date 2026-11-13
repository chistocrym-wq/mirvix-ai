import test from 'node:test';
import assert from 'node:assert/strict';
import {siteKind,seoAnalysis,aiAnalysis,priorityActions,trafficSummary} from '../netlify/lib/geo-intelligence-core.mjs';

const input={url:'https://ourclinic.ru/',search:'both',queries:['мрт спб','узи спб'],competitors:['clinic-competitor.ru']};
const hits=[
{engine:'google',query:'мрт спб',position:1,url:'https://clinic-competitor.ru/mrt',title:'МРТ платная клиника',snippet:'Магнитно резонансная томография'},
{engine:'google',query:'мрт спб',position:2,url:'https://prodoctorov.ru/mrt',title:'Каталог врачей'},
{engine:'google',query:'мрт спб',position:15,url:'https://ourclinic.ru/mrt',title:'МРТ в клинике'},
{engine:'yandex',query:'мрт спб',position:3,url:'https://unknownclinic.ru',title:'МРТ Санкт-Петербург'},
{engine:'google',query:'узи спб',position:12,url:'https://ourclinic.ru/ultrasound',title:'УЗИ'}
];
test('SEOs classify directories separately and track confirmed vs candidate rivals',()=>{
 assert.equal(siteKind(hits[1]),'Каталог или платформа');
 const r=seoAnalysis(input,hits);
 assert.equal(r.rows.length,4);
 assert.equal(r.measured,3);
 assert.equal(r.rows[0].opportunity,'Подтверждённый SEO-разрыв');
 assert.equal(r.rows[1].opportunity,'Гипотеза: конкурентный разрыв');
 assert.equal(r.rows[2].ownPosition,12);
 assert.equal(r.candidates.find(x=>x.domain==='clinic-competitor.ru').confirmed,true);
 assert.equal(r.candidates.find(x=>x.domain==='prodoctorov.ru').type,'Каталог или платформа');
 assert.equal(r.ownTop20,2);
});
test('web answer errors and model-only outputs never count as missed brand',()=>{
 const plan={prompts:['где мрт'],providers:['openai','gigachat','gemini']};
 const results=[
  {provider:'openai',prompt:'где мрт',answer:'Рекомендую Clinix',brandMention:false,sourceMention:false,
   competitorsMentioned:['Clinix'],mode:'web-grounded',searchEvidence:true,checkedAt:'2026-11-12'},
  {provider:'gemini',prompt:'где мрт',error:'API unavailable'},
  {provider:'gigachat',prompt:'где мрт',answer:'Наша клиника',brandMention:true,mode:'model-only'}
 ];
 const r=aiAnalysis(plan,results,'Наша клиника',['Clinix']);
 assert.equal(r.successfulWebAnswers,1);
 assert.equal(r.modelOnlyAnswers,1);
 assert.equal(r.errors,1);
 assert.equal(r.rivalOnlyQuestions.length,1);
 assert.equal(r.mentionRate,0);
});
test('actions do not invent visits or attribution',()=>{
 const r=trafficSummary(null);
 assert.equal(r.visits,null);
 assert.equal(r.leads,null);
 const p=priorityActions({confirmedGaps:1,possibleGaps:1,measured:3},
  {rivalOnlyQuestions:[{prompt:'мрт'}],attempted:1},null,r);
 assert.ok(p.some(x=>x.area==='Аналитика'));
 assert.ok(p.some(x=>x.area==='GEO'));
 assert.ok(!JSON.stringify(p).includes('гарант'));
});
test('verified uploaded traffic keeps explicit source',()=>{
 const r=trafficSummary({source:'CSV из Яндекс.Метрики + CRM (предоставлен клиентом)',period:'2026-10',addedAt:'2026-11-12',
  rows:[{source:'Поиск',visits:100,leads:5},{source:'ИИ',visits:7,leads:1}]});
 assert.equal(r.visits,107);
 assert.equal(r.leads,6);
 assert.match(r.note,/не подтверждены/);
});
