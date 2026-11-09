import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

const root=new URL('../',import.meta.url);
const read=file=>readFileSync(new URL(file,root),'utf8');
class Element {
  constructor(name='') {
    this.name=name;this.children=[];this.listeners={};this.value='';this.textContent='';
    this.hidden=['dialog','voicecheck','delivery-panel'].includes(name);
    this.checked=false;this.scrollHeight=100;this.scrollTop=0;
    this.classList={add(){},remove(){}};this.attributes={};this.style={};
  }
  appendChild(node){
    if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);
    this.children.push(node);node.parentElement=this;return node;
  }
  insertBefore(node,other){
    if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);
    const i=this.children.indexOf(other);
    this.children.splice(i<0?this.children.length:i,0,node);node.parentElement=this;
    return node;
  }
  querySelector(selector){return this.children.find(x=>selector==='.mobile-toggle'&&x.name==='mobile-toggle')||null;}
  replaceChildren(){for(const child of this.children)child.parentElement=null;this.children=[];}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(event,callback){this.listeners[event]=callback;}
  focus(){}
}
function prepareWidget(){
  const names=['launch','dialog','close','history','input','send','mic','voicecheck',
    'transcript','ai-consent','delivery-consent','delivery-panel','confirm','retry','cancel'];
  const elements=Object.fromEntries(names.map(n=>[n,new Element(n)]));
  const root=new Element('widget');
  root.querySelector=selector=>elements[selector.match(/data-mira="([^"]+)"/)?.[1]];
  root.appendChild(elements.launch);
  const header=new Element('header');
  const menu=new Element('mobile-toggle');header.appendChild(menu);
  const mobile={matches:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
  const body={classList:{add(){},remove(){}}};
  const document={body,getElementById:id=>id==='mira-widget'?root:null,
    querySelector:selector=>selector==='.site-header .header-inner'?header:null,
    createElement:tag=>new Element(tag)};
  runInNewContext(read('assets/mira-widget.js'),{document,
    window:{matchMedia:()=>mobile}});
  return {...elements,_header:header,_root:root,_mobile:mobile};
}
test('removed the entire developments block and its dead navigation links',()=>{
  const page=read('index.html');
  assert.ok(!page.includes('id="projects"'));
  assert.ok(!page.includes('href="#projects"'));
  assert.ok(!page.includes('СОБСТВЕННЫЕ РАЗРАБОТКИ'));
  assert.ok(!page.includes('selectFilter('));
  assert.ok(page.includes('id="platform"'));
  assert.ok(page.includes('id="about"'));
});
test('main-page inline executable scripts remain syntactically valid',()=>{
  const html=read('index.html');
  const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for(const [i,item] of scripts.entries()){
    if(/type=["']application\/ld\+json["']/i.test(item[1]))continue;
    if(item[2].trim())new Script(item[2],{filename:'homepage-inline-'+i+'.js'});
  }
});
test('MIRA does not speak first and greets only after the visitor writes',()=>{
  const e=prepareWidget();
  assert.equal(e.history.children.length,0);
  e.input.value='Мне нужен бот для стоматологии, отвечать пациентам на вопросы';
  e.send.listeners.click();
  const texts=e.history.children.map(x=>x.textContent);
  assert.equal(texts[0],e.history.children[0].textContent);
  assert.match(texts[0],/Мне нужен бот/);
  assert.match(texts[1],/Здравствуйте.*MIRA/);
  assert.ok(!texts.join(' ').includes('красиво'));
  assert.ok(texts.some(t=>t.includes('Сформулирую так:')));
  const brief=texts.find(t=>t.includes('Сформулирую так:')).split('\n')[0];
  assert.ok(!brief.includes('Пожелания клиента'));
  assert.ok(brief.length<360);
  assert.match(brief,/стоматологической клиники/);
});
test('MIRA replies with a natural farewell when the visitor ends the conversation',()=>{
  const e=prepareWidget();
  e.input.value='Нужен сайт для салона красоты';
  e.send.listeners.click();
  e.input.value='До свидания';
  e.send.listeners.click();
  const texts=e.history.children.map(x=>x.textContent);
  assert.match(texts.at(-1),/Всего доброго, до связи/);
  assert.equal(texts.filter(t=>t.includes('Здравствуйте! Я MIRA')).length,1);
});
test('server-side brief strips a prefix and extra sentences',async()=>{
  const previous={key:process.env.OPENAI_API_KEY,base:process.env.OPENAI_BASE_URL};
  const originalFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='test-dummy-key';
  process.env.OPENAI_BASE_URL='https://example.test/v1';
  globalThis.fetch=async()=>new Response(JSON.stringify({
    choices:[{message:{content:'Задача: Требуется создать сайт для стоматологической клиники. Второе предложение лишнее.'}}]
  }),{status:200,headers:{'content-type':'application/json'}});
  try{
    const {default:handler}=await import('../netlify/functions/mira-brief.mjs');
    const req=new Request('https://mirvixai.com/api/mira-brief',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text:'Мне нужен сайт для стоматологии, хочу сайт',consent:true})
    });
    const response=await handler(req);
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.formulated,'Требуется создать сайт для стоматологической клиники.');
  }finally{
    globalThis.fetch=originalFetch;
    if(previous.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.key;
    if(previous.base===undefined)delete process.env.OPENAI_BASE_URL;else process.env.OPENAI_BASE_URL=previous.base;
  }
});

test('mobile MIRA launcher docks in header and is removed from floating widget',()=>{
  const e=prepareWidget();
  assert.equal(e.launch.parentElement,e._root);
  e._mobile.matches=true;e._mobile.listeners.change();
  assert.equal(e.launch.parentElement,e._header);
  assert.ok(e._header.children.indexOf(e.launch)<e._header.children.findIndex(x=>x.name==='mobile-toggle'));
  e._mobile.matches=false;e._mobile.listeners.change();
  assert.equal(e.launch.parentElement,e._root);
});

test('duplicate same text is ignored within a short window',()=>{
  const e=prepareWidget();
  e.input.value='Нужен бот для салона красоты';
  e.send.listeners.click();
  const before=e.history.children.length;
  e.input.value='Нужен бот для салона красоты';
  e.send.listeners.click();
  assert.equal(e.history.children.length,before);
});

test('mobile and desktop variants use breakpoint and fullscreen chat',()=>{
  const css=read('assets/mira-widget-extra.css');
  assert.match(css,/@media\(max-width:960px\)/);
  assert.match(css,/\.site-header \.mira-launch/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/height:100dvh/);
  assert.match(css,/body\.mira-chat-open\{overflow:hidden\}/);
});
