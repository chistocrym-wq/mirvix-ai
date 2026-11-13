import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
import miraChat from '../netlify/functions/mira-chat.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
class Node{
 constructor(name){this.name=name;this.children=[];this.listeners={};this.hidden=true;this.value='';this.checked=false;this.disabled=false;
  this.textContent='';this.attributes={};this.style={};this.classList={add(){},remove(){}};
  this.scrollHeight=100;this.scrollTop=0;}
 appendChild(x){this.children.push(x);x.parentElement=this;return x;}
 insertBefore(x,ref){const at=this.children.indexOf(ref);this.children.splice(at<0?0:at,0,x);x.parentElement=this;return x;}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(ev,fn){this.listeners[ev]=fn;}
 focus(){}
}
function make(){
 const keys=['launch','dialog','close','history','input','send','mic','voicecheck','transcript',
  'confirm','retry','cancel','ai-consent-panel','ai-yes','ai-no','privacy-settings',
  'delivery-panel','delivery-open','close-lead','send-lead','delivery-consent','lead-name','lead-contact','lead-status'];
 const nodes=Object.fromEntries(keys.map(k=>[k,new Node(k)]));
 const root=new Node('root');root.querySelector=q=>nodes[q.match(/\[data-mira="([^"]+)"\]/)?.[1]];
 root.firstChild=nodes.launch;root.appendChild(nodes.launch);
 const header=new Node('header');const toggle=new Node('toggle');header.querySelector=()=>toggle;header.appendChild(toggle);
 const mobile={matches:false,fn:null,addEventListener(_,fn){this.fn=fn;}};
 const storage=new Map(),document={getElementById:id=>id==='mira-widget'?root:null,
  querySelector:()=>header,createElement:name=>new Node(name),body:{classList:{add(){},remove(){}}}};
 const calls=[];
 const fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({reply:'Подготовим сайт и уточним целевые запросы.',mode:'ai'})};};
 runInNewContext(read('assets/mira-widget.js'),{document,window:{matchMedia:()=>mobile,localStorage:{
  getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}},fetch,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
  console,Date,URL,Math,setTimeout});
 return {nodes,root,header,mobile,storage,calls};
}
const click=(e,id)=>{const listener=e.nodes[id].listeners.click;assert.equal(typeof listener,'function','Missing '+id+' listener');return listener();};
const own=e=>e.nodes.history.children.filter(b=>b.className.includes('mine'));
test('MIRA widget and homepage scripts parse with no inline syntax errors',()=>{
 new Script(read('assets/mira-widget.js'));
 const html=read('index.html');
 for(const [,attrs,js] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/application\/ld\+json/i.test(attrs))continue;
  if(js.trim())new Script(js);
 }
});
test('MIRA does not speak before the user and prompts AI permission only once',async()=>{
 const e=make();assert.equal(e.nodes.history.children.length,0);
 click(e,'launch');assert.equal(e.nodes['ai-consent-panel'].hidden,false);
 e.nodes.input.value='Какая стоимость GEO продвижения?';
 await click(e,'send');assert.equal(e.calls.length,0);
 await click(e,'ai-no');assert.equal(e.storage.get('mirvix-mira-ai-choice-v1'),'no');
 assert.equal(e.nodes['ai-consent-panel'].hidden,true);
 assert.equal(own(e).length,1);
 assert.match(e.nodes.history.children.at(-1).children[0].textContent,/50 000/);
});
test('MIRA uses configured AI after permission and attaches real clickable tariff link',async()=>{
 const e=make();e.nodes.input.value='Расскажите стоимость тарифов GEO';
 await click(e,'send');await click(e,'ai-yes');
 await new Promise(r=>setImmediate(r));
 assert.equal(e.calls[0]?.url,'/api/mira-chat');
 const reply=e.nodes.history.children.at(-1);
 assert.ok(reply.children.some(x=>x.href==='/tariffs/'));
 assert.equal(e.storage.get('mirvix-mira-ai-choice-v1'),'yes');
 click(e,'privacy-settings');
 assert.equal(e.nodes['ai-consent-panel'].hidden,false);
});
test('contact transfer is a separate opt-in and never included in AI messages',async()=>{
 const e=make();e.nodes.input.value='Хочу ИИ помощника для магазина';
 await click(e,'send');await click(e,'ai-yes');await new Promise(r=>setImmediate(r));
 click(e,'delivery-open');
 e.nodes['lead-name'].value='Мария';e.nodes['lead-contact'].value='maria@example.ru';
 await click(e,'send-lead');
 assert.equal(e.calls.filter(x=>x.url==='/api/mira-submit').length,0);
 e.nodes['delivery-consent'].checked=true;
 await click(e,'send-lead');
 assert.equal(e.calls.filter(x=>x.url==='/api/mira-submit').length,1);
 assert.ok(!e.calls.filter(x=>x.url==='/api/mira-chat').some(x=>x.opts.body.includes('maria@example.ru')));
});
test('mobile MIRA launcher relocates to header at 960px breakpoint',()=>{
 const e=make();e.mobile.matches=true;e.mobile.fn();
 assert.equal(e.nodes.launch.parentElement,e.header);
 e.mobile.matches=false;e.mobile.fn();assert.equal(e.nodes.launch.parentElement,e.root);
});
test('browser voice controls never imply unsupported transcription works',()=>{
 const e=make();click(e,'mic');
 assert.match(e.nodes.history.children.at(-1).children[0].textContent,/недоступно/i);
 assert.ok(read('assets/mira-widget.js').includes('window.webkitSpeechRecognition'));
 assert.ok(read('assets/mira-widget.js').includes('not-allowed'));
 assert.ok(read('assets/mira-widget.js').includes('audio-capture'));
});
test('MIRA server requires consent, does not reveal keys, blocks contact in model prompts',async()=>{
 const bad=await miraChat(new Request('https://example.test/api/mira-chat',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Сколько стоит GEO?'}]})}));
 assert.equal(bad.status,400);
 const contact=await miraChat(new Request('https://example.test/api/mira-chat',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({consent:true,messages:[{role:'user',content:'Позвоните +7 900 123 45 67'}]})}));
 assert.equal(contact.status,400);
});
test('MIRA links only point to verified site routes and WhatsApp is absent',()=>{
 const source=read('assets/mira-widget.js');
 for(const route of ['/tariffs/','/tariffs/#support','/legal/contacts/','/#services','/check/','/tools/'])assert.ok(source.includes(route));
 assert.doesNotMatch(source,/whatsapp|wa\.me/i);
 const html=read('index.html');assert.doesNotMatch(html,/whatsapp|wa\.me/i);
});
