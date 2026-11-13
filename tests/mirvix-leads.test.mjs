import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acceptLead,dispatchPending,parseLead} from '../netlify/lib/mirvix-lead-outbox.mjs';

const lead={name:'Мария',contact:'maria@example.org',task:'Нужна GEO-проверка клиники с рекомендациями по 2 запросам',
 consent:true,requestId:'release-test-unique-001'};
const makeStore=()=>{
 const data=new Map();
 return {
  data,
  async get(k){return data.get(k)||null;},
  async setJSON(k,v){data.set(k,structuredClone(v));},
  async list({prefix}){return {blobs:[...data.keys()].filter(x=>x.startsWith(prefix)).map(key=>({key})),cursor:null};}
 };
};
const successTelegram=async()=>({ok:true,json:async()=>({ok:true})});
test('storage write is mandatory before any notification or confirmed receipt',async()=>{
 const store=makeStore();
 let notified=false;
 const result=await acceptLead(store,lead,'general',{fetcher:async()=>{
  assert.ok(store.data.size===1,'Must persist before notification');
  notified=true;return {ok:true,json:async()=>({ok:true})};},
  env:{MIRA_TELEGRAM_BOT_TOKEN:'test',MIRA_TELEGRAM_CHAT_ID:'123456'}});
 assert.equal(result.saved,true);assert.equal(result.notification,'sent');assert.equal(notified,true);
 assert.ok(store.data.has('leads/'+lead.requestId));
});
test('no success receipt when persistent storage fails',async()=>{
 const store=makeStore();store.setJSON=async()=>{throw Error('disk down');};
 await assert.rejects(acceptLead(store,lead,'general'),/disk down/);
});
test('Telegram outage cannot lose lead and retry sends exactly once',async()=>{
 const store=makeStore();
 const env={MIRA_TELEGRAM_BOT_TOKEN:'test',MIRA_TELEGRAM_CHAT_ID:'123456'};
 const saved=await acceptLead(store,lead,'general',{env,fetcher:async()=>{throw Error('network');}});
 assert.equal(saved.saved,true);assert.equal(saved.notification,'pending');
 assert.equal(store.data.get('leads/'+lead.requestId).state,'notification_pending');
 const out=await dispatchPending(store,{env,fetcher:successTelegram});
 assert.equal(out.delivered,1);
 assert.equal(store.data.get('leads/'+lead.requestId).state,'notified');
 const again=await dispatchPending(store,{env,fetcher:async()=>{throw Error('should not retry delivered');}});
 assert.equal(again.attempted,0);
});
test('idempotent client retries reuse one saved record',async()=>{
 const store=makeStore();
 const first=await acceptLead(store,lead,'general',{notify:false});
 const second=await acceptLead(store,{...lead,task:'a different message'},'general',{notify:false});
 assert.equal(first.id,second.id);
 assert.equal(store.data.size,1);
 assert.equal(store.data.get('leads/'+lead.requestId).payload.task,lead.task);
});
test('forbids sending personal contacts without separate consent',()=>{
 assert.throws(()=>parseLead({...lead,consent:false},'mira'),/согласие/);
 assert.throws(()=>parseLead({...lead,contact:'wa.me/1234567890'},'general'),/Telegram/);
});
test('public forms use durable API and disallow WhatsApp; no mailto submit',()=>{
 const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
 for(const path of ['index.html','tools/index.html','check/index.html','legal/contacts/index.html',
  'legal/privacy/index.html','assets/mira-widget.js'])assert.doesNotMatch(read(path),/whatsapp|wa\.me/i,path);
 assert.match(read('assets/mirvix-lead-form.js'),/\/api\/mirvix-lead/);
 assert.match(read('netlify/functions/mira-submit.mjs'),/acceptLead/);
 assert.match(read('netlify/functions/ai-visibility-request.mjs'),/acceptLead/);
 assert.match(read('netlify/functions/mirvix-lead-dispatch.mjs'),/schedule:/);
 assert.doesNotMatch(read('index.html'),/id="mirvix-lead" action="mailto/);
});
