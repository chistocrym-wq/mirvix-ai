import test from 'node:test';
import assert from 'node:assert/strict';
import { inputConfig, publicUrl, domainOf, parseOrganic, collectPlatforms,
 evaluate, makeBrief, exportRows, csv, xlsx } from '../netlify/lib/geo-publisher-core.mjs';

const input=()=>inputConfig({
 url:'https://example-client.ru', brand:'Test Brand', region:'Санкт-Петербург, Россия',
 queries:'строительные материалы в Санкт-Петербурге\nмагазин стройматериалов',search:'both',gl:'ru',lr:'2',max:30,
 competitors:'https://competitor.ru', exclusions:'https://used.ru',audience:'Покупатели стройматериалов'
});
const hits=[
 {domain:'journal.ru',url:'https://journal.ru/post',query:'строительные материалы в Санкт-Петербурге',engine:'google',
  title:'Строительные материалы — обзор магазинов',snippet:'Экспертная статья о строительных материалах',position:3},
 {domain:'journal.ru',url:'https://journal.ru/post',query:'строительные материалы в Санкт-Петербурге',engine:'yandex',
  title:'Строительные материалы — обзор магазинов',snippet:'Экспертная статья',position:6},
 {domain:'competitor.ru',url:'https://competitor.ru/article',query:'магазин стройматериалов',engine:'google',position:1},
 {domain:'used.ru',url:'https://used.ru/list',query:'магазин стройматериалов',engine:'google',position:1}
];
test('input accepts meaningful query clusters and rejects unsafe URLs',()=>{
 const i=input();
 assert.equal(i.queries.length,2);
 assert.equal(i.domain,'example-client.ru');
 for(const s of ['http://example.org','https://127.0.0.1','https://localhost','https://user:pass@example.com','https://example.com:8080','https://internal.local','javascript:alert(1)'])
  assert.throws(()=>publicUrl(s));
 assert.equal(domainOf('https://www.journal.ru/post'),'journal.ru');
 assert.throws(()=>inputConfig({...i,queries:'\n'}));
 assert.throws(()=>inputConfig({...i,lr:'',search:'yandex'}));
});
test('organic data is sourced only from valid API results',()=>{
 const parsed=parseOrganic({organic_results:[
  {link:'https://journal.ru/post',title:'Article',position:1},
  {link:'http://unsafe.com/post',title:'Plain HTTP',position:2},
  {link:'https://127.0.0.1/',position:3}
 ]},'google','тестовый запрос');
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].position,1);
 assert.throws(()=>parseOrganic({error:'quota exceeded'},'google','x'));
});
test('deduplicates sites across engines and excludes competitors',()=>{
 const p=collectPlatforms(hits,input());
 assert.equal(p.length,1);
 assert.equal(p[0].domain,'journal.ru');
 assert.equal(p[0].matches.length,2);
});
test('unknown evidence does not become invented score, price or publication permission',()=>{
 const i=input(),p=collectPlatforms(hits,i)[0],scored=evaluate(p,i,4);
 assert.equal(scored.score,null);
 assert.equal(scored.scoreMin>=0,true);
 assert.equal(scored.scoreMax>scored.scoreMin,true);
 assert.equal(scored.publication.status,'unknown');
 assert.equal(scored.price,null);
 const brief=makeBrief(scored,i);
 assert.match(brief,/не подтверждены/i);
 assert.match(brief,/Test Brand/);
});
test('full confirmed report includes evidence and preserves site-specific client score',()=>{
 const i=input(),p=collectPlatforms(hits,i)[0];
 p.publication={status:'confirmed',source:'https://journal.ru/advertise',conditions:'Только обзоры',verifiedAt:'2026-11-11'};
 p.quality=80;p.geographyEvidence=70;p.price=1500;
 const report=evaluate(p,i,4);
 assert.equal(report.coverage,100);
 assert.equal(typeof report.score,'number');
 assert.equal(report.publication.source,'https://journal.ru/advertise');
 const rows=exportRows({input:i,platforms:[{...report,brief:makeBrief(report,i)}]});
 assert.equal(rows.length,2);
 assert.match(csv(rows),/journal\.ru/);
 const buf=xlsx(rows);
 assert.equal(buf.readUInt32LE(0),0x04034b50);
 assert.equal(buf.subarray(-22).readUInt32LE(0),0x06054b50);
});
test('CSV sanitizes spreadsheet formula injection',()=>{
 assert.match(csv([['name'],['=HYPERLINK("https://evil.test")']]),/"'=HYPERLINK/);
});
