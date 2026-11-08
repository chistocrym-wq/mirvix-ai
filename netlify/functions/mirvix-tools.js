// MIRVIX AI admin-only API. All secrets are Netlify environment variables.
const { getStore, getDeployStore } = require("@netlify/blobs");
const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const net = require("node:net");

const headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const reply=(status,data)=>({statusCode:status,headers,body:JSON.stringify(data)});
const context=process.env.CONTEXT||"production";
const preview=context!=="production";
const safeString=(v,max=1000)=>String(v??"").trim().slice(0,max);
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
function authorize(event){
  const wanted=process.env.MIRVIX_CABINET_TOKEN;
  if(!wanted||wanted.length<20)return false;
  const supplied=(event.headers.authorization||event.headers.Authorization||"").replace(/^Bearer\s+/i,"");
  const a=Buffer.from(supplied),b=Buffer.from(wanted);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function store(){return preview?getDeployStore("mirvix-visibility-preview"):getStore("mirvix-visibility-prod")}
function base(){return {company:"",url:"",region:"",category:"",competitors:[],queries:[],checks:[],tasks:[],audits:[],period:"Базовый замер",history:[],updatedAt:null}}
function validate(data){
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Неверные данные");
  const out=base();
  for(const k of ["company","url","region","category","period"])out[k]=safeString(data[k],k==="url"?300:120);
  out.competitors=Array.isArray(data.competitors)?data.competitors.slice(0,30).map(x=>safeString(x,120)):[];
  out.queries=Array.isArray(data.queries)?[...new Set(data.queries.slice(0,200).map(x=>safeString(x,300)).filter(Boolean))]:[];
  out.checks=Array.isArray(data.checks)?data.checks.slice(-1500).map(x=>({ai:safeString(x.ai,40),query:safeString(x.query,300),result:safeString(x.result,40),answer:safeString(x.answer,6000),sources:Array.isArray(x.sources)?x.sources.slice(0,20).map(u=>safeString(u,500)):[],competitors:safeString(x.competitors,500),at:safeString(x.at,60),method:safeString(x.method,40),model:safeString(x.model,80),error:safeString(x.error,300)})):[];
  out.tasks=Array.isArray(data.tasks)?data.tasks.slice(0,100).map(x=>({name:safeString(x.name,250),done:!!x.done,notes:safeString(x.notes,1000)})):[];
  out.audits=Array.isArray(data.audits)?data.audits.slice(-15):[];
  out.history=Array.isArray(data.history)?data.history.slice(-50):[];
  out.updatedAt=new Date().toISOString();
  if(JSON.stringify(out).length>650000)throw Error("Данные превышают лимит");
  return out;
}
function publicIp(ip){
  const t=net.isIP(ip);
  if(t===4){const p=ip.split(".").map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===192&&p[1]===0||p[0]===198&&p[1]>=18&&p[1]<=19||p[0]===198&&p[1]===51&&p[2]===100||p[0]===203&&p[1]===0&&p[2]===113);}
  if(t===6){const a=ip.toLowerCase();return !(a==="::"||a==="::1"||a.startsWith("fe80:")||a.startsWith("fc")||a.startsWith("fd")||a.startsWith("ff")||a.startsWith("::ffff:")||a.startsWith("2001:db8:"))}
  return false;
}
async function externalUrl(raw){
  const u=new URL(raw);
  if(u.protocol!=="https:"&&u.protocol!=="http:")throw Error("Допускается только HTTP(S)");
  if(u.username||u.password||u.port&&u.port!=="443"&&u.port!=="80")throw Error("Запрещены нестандартные адреса");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||net.isIP(host))throw Error("Доступ к IP и внутренним хостам запрещён");
  const records=await dns.lookup(host,{all:true,verbatim:true});
  if(!records.length||records.some(x=>!publicIp(x.address)))throw Error("Адрес указывает на частную или недоступную сеть");
  return u;
}
async function requestPage(raw){
  let u=await externalUrl(raw);
  for(let i=0;i<3;i++){
    const r=await fetch(u.toString(),{redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"user-agent":"MIRVIX-Audit/1.0 (+https://mirvixai.com)","accept":"text/html,text/plain,application/xml;q=0.9,*/*;q=0.1"}});
    if([301,302,303,307,308].includes(r.status)&&r.headers.has("location")){
      if(i===2)throw Error("Слишком много перенаправлений");
      u=await externalUrl(new URL(r.headers.get("location"),u).toString());continue;
    }
    const len=Number(r.headers.get("content-length")||0);
    if(len>250000)throw Error("Файл слишком большой");
    const reader=r.body?.getReader();let text="",bytes=0;
    if(reader)while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>250000){await reader.cancel();throw Error("Превышен лимит размера ответа")}text+=new TextDecoder().decode(value)}
    return {status:r.status,url:u.toString(),text,contentType:r.headers.get("content-type")||""};
  }
}
function match(html,re){return (html.match(re)||[])[1]||""}
async function audit(url){
  const u=await externalUrl(url),origin=u.origin;
  const result={checkedAt:new Date().toISOString(),requested:url,checks:[],errors:[]};
  const add=(name,status,detail)=>result.checks.push({name,status,detail:safeString(detail,400)});
  let home;
  try{home=await requestPage(u.toString());add("HTTP главной",home.status>=200&&home.status<300?"ok":"issue",String(home.status)+" · "+home.url)}
  catch(e){add("HTTP главной","unknown",String(e.message));return result}
  if(home.status>=200&&home.status<300&&/html/i.test(home.contentType)){
    const h=home.text;
    const title=match(h,/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/<[^>]+>/g,"").trim();
    const desc=match(h,/<meta(?=[^>]*name=["']description["'])(?=[^>]*content=["']([^"']*)["'])[^>]*>/i);
    const canonical=match(h,/<link(?=[^>]*rel=["']canonical["'])(?=[^>]*href=["']([^"']*)["'])[^>]*>/i);
    const noindex=/<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(h)||/<meta[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots/i.test(h);
    add("Title",title?"ok":"issue",title||"Не найден");
    add("Description",desc?"ok":"issue",desc||"Не найден");
    add("H1",/<h1[\s>]/i.test(h)?"ok":"issue",/<h1[\s>]/i.test(h)?"Найден":"Не найден");
    add("Canonical",canonical?"ok":"unknown",canonical||"Не обнаружен");
    add("Meta robots",noindex?"issue":"ok",noindex?"Обнаружен noindex":"Noindex в HTML не найден (заголовки X-Robots-Tag не проверены)");
    add("Schema.org JSON-LD",/application\/ld\+json/i.test(h)?"ok":"unknown",/application\/ld\+json/i.test(h)?"Разметка присутствует (валидность не проверена)":"Не обнаружена");
    add("Основной текст HTML",h.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().length>400?"ok":"unknown","Эвристическая проверка текста, не оценка качества");
  } else add("Разбор HTML","unknown","Страница не отдала успешный HTML");
  for(const file of ["robots.txt","sitemap.xml"]){
    try{const p=await requestPage(origin+"/"+file);
      if(p.status!==200){add(file,"issue","HTTP "+p.status);continue}
      if(file==="robots.txt"){add(file,"ok","Получен robots.txt ("+p.text.length+" символов)");add("Правила robots", "unknown","Требуется разбор правил для конкретных user-agent; наличие файла не доказывает разрешение")}
      else add(file,/<(urlset|sitemapindex)\b/i.test(p.text)?"ok":"issue","HTTP 200; XML-корень "+(/<(urlset|sitemapindex)\b/i.test(p.text)?"найден":"не найден"));
    }catch(e){add(file,"unknown",e.message)}
  }
  add("Фактическая индексация","unknown","Не проверяется без данных Google Search Console / Яндекс Вебмастера");
  add("Доступность для ChatGPT/Gemini/Copilot","unknown","Нельзя гарантировать по одному HTTP-тесту");
  return result;
}
function citations(arr){return [...new Set(arr.filter(x=>typeof x==="string"&&/^https?:\/\//.test(x)).slice(0,25))]}
async function callAI(provider,question){
  let r,data,txt,sources=[],model="";
  if(provider==="OpenAI API"){
    if(!process.env.OPENAI_API_KEY)throw Error("OPENAI_API_KEY не настроен");
    model=process.env.MIRVIX_OPENAI_MODEL||"gpt-5.4";
    r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"authorization":"Bearer "+process.env.OPENAI_API_KEY,"content-type":"application/json"},body:JSON.stringify({model,tools:[{type:"web_search",search_context_size:"low"}],tool_choice:"required",input:question,max_output_tokens:900}),signal:AbortSignal.timeout(45000)});
    data=await r.json();
    if(!r.ok)throw Error("OpenAI HTTP "+r.status+": "+safeString(data.error?.message,180));
    const items=(data.output||[]).filter(x=>x.type==="message").flatMap(x=>x.content||[]);
    txt=items.filter(x=>x.type==="output_text").map(x=>x.text).join("\n");
    sources=citations(items.flatMap(x=>(x.annotations||[]).filter(a=>a.type==="url_citation").map(a=>a.url)));
  }else if(provider==="Perplexity API"){
    if(!process.env.PERPLEXITY_API_KEY)throw Error("PERPLEXITY_API_KEY не настроен");
    model=process.env.MIRVIX_PERPLEXITY_MODEL||"sonar";
    r=await fetch("https://api.perplexity.ai/chat/completions",{method:"POST",headers:{"authorization":"Bearer "+process.env.PERPLEXITY_API_KEY,"content-type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:question}],max_tokens:850}),signal:AbortSignal.timeout(45000)});
    data=await r.json();
    if(!r.ok)throw Error("Perplexity HTTP "+r.status+": "+safeString(data.error?.message,180));
    txt=data.choices?.[0]?.message?.content||"";
    sources=citations(data.citations||[]);
  }else if(provider==="Gemini API"){
    if(!process.env.GEMINI_API_KEY)throw Error("GEMINI_API_KEY не настроен");
    model=process.env.MIRVIX_GEMINI_MODEL||"gemini-2.5-flash";
    r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:question}]}],tools:[{google_search:{}}]}),signal:AbortSignal.timeout(45000)});
    data=await r.json();
    if(!r.ok)throw Error("Gemini HTTP "+r.status+": "+safeString(data.error?.message,180));
    txt=(data.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("\n");
    sources=citations((data.candidates?.[0]?.groundingMetadata?.groundingChunks||[]).map(x=>x.web?.uri));
  }else throw Error("Этот поставщик доступен только для ручной проверки");
  if(!txt.trim())throw Error("API вернул пустой ответ");
  return {provider,model,answer:safeString(txt,6000),sources,at:new Date().toISOString()};
}
exports.handler=async(event)=>{
  try{
    if(event.httpMethod==="OPTIONS")return reply(405,{error:"CORS не используется"});
    if(!authorize(event))return reply(process.env.MIRVIX_CABINET_TOKEN?401:503,{error:process.env.MIRVIX_CABINET_TOKEN?"Неверный токен кабинета":"Добавьте MIRVIX_CABINET_TOKEN (не менее 20 символов) в Netlify Environment Variables"});
    const action=event.queryStringParameters?.action||"status";
    const body=event.httpMethod==="POST"?JSON.parse(event.body||"{}"):{};
    if(event.httpMethod==="GET"&&action==="status")return reply(200,{ok:true,preview,storage:preview?"deploy-only":"site-wide",providers:{"OpenAI API":!!process.env.OPENAI_API_KEY,"Perplexity API":!!process.env.PERPLEXITY_API_KEY,"Gemini API":!!process.env.GEMINI_API_KEY},manual:["ChatGPT","Gemini","Perplexity","Copilot","Алиса AI"]});
    if(event.httpMethod==="GET"&&action==="load"){const data=await store().get("admin-project",{type:"json"});return reply(200,{project:data||base()})}
    if(event.httpMethod==="POST"&&action==="save"){const project=validate(body.project);await store().setJSON("admin-project",project);return reply(200,{ok:true,updatedAt:project.updatedAt})}
    if(event.httpMethod==="POST"&&action==="audit"){const url=safeString(body.url,300);if(!url)return reply(400,{error:"Укажите адрес сайта"});return reply(200,{audit:await audit(url)})}
    if(event.httpMethod==="POST"&&action==="probe"){const provider=safeString(body.provider,40),question=safeString(body.question,300);if(question.length<8||question.length>300)return reply(400,{error:"Неверный запрос"});return reply(200,{result:await callAI(provider,question)})}
    return reply(404,{error:"Неизвестное действие"});
  }catch(e){console.error("MIRVIX API",e.message);return reply(400,{error:safeString(e.message,250)})}
};