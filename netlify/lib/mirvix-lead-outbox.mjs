import {getStore} from '@netlify/blobs';
import {randomUUID} from 'node:crypto';

const STORE='mirvix-leads-v1';
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const reply=(body,status=200)=>Response.json(body,{status,headers:HEADERS});
export const leadStore=()=>getStore({name:STORE,consistency:'strong'});
const norm=(x,n=500)=>String(x??'').trim().slice(0,n);
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{14,90}$/.test(x)?x:null;
const key=id=>'leads/'+id;
const time=()=>new Date().toISOString();
export function sameOrigin(request){
 const o=request.headers.get('origin');if(!o)return true;
 try{return new URL(o).origin===new URL(request.url).origin;}catch{return false;}
}
export function parseLead(body,type){
 if(!body||body.consent!==true)throw Error('Для передачи контактов необходимо отдельное согласие.');
 if(!['general','mira','ai-check'].includes(type))throw Error('Неизвестная форма заявки.');
 const name=norm(body.name||body.client_name,100);
 const contact=norm(body.contact||body.client_contact,180);
 const task=norm(body.task||body.message||body.questions||'Запрос на консультацию',2900);
 if(name.length<2||contact.length<5||task.length<8)throw Error('Укажите имя, способ связи и описание задачи.');
 if(/(?:wa\.me|whatsapp)/i.test(contact))throw Error('Выберите Telegram, электронную почту или телефон.');
 const result={
  name,contact,task,type,
  company:norm(body.company||'',140),site:norm(body.site||'',230),
  competitor:norm(body.competitor||'',140),competitorSite:norm(body.competitorSite||'',230),
  service:norm(body.service||body.plan||'',110),category:norm(body.category||'',200),
  questions:norm(body.questions||'',1000),productLinks:norm(body.productLinks||'',1000),
  original:norm(body.original||'',1900),channel:norm(body.channel||'',30)
 };
 if(type==='ai-check'&&(!result.company||!result.site||!result.category))throw Error('Заполните компанию, сайт и сферу деятельности.');
 return result;
}
export async function notifyTelegram(record,{fetcher=fetch,env=process.env}={}){
 const token=env.MIRA_TELEGRAM_BOT_TOKEN,chat=env.MIRA_TELEGRAM_CHAT_ID;
 if(!token||!/^-?\d{5,22}$/.test(chat||''))return {ok:false,error:'Telegram не настроен'};
 const d=record.payload;
 const msg=[
  '📨 MIRVIX AI · сохранённая заявка №'+record.id,
  'Тип: '+record.type,'Имя: '+d.name,'Контакт: '+d.contact,
  d.company&&'Компания: '+d.company,d.site&&'Сайт: '+d.site,
  d.category&&'Ниша: '+d.category,d.competitor&&'Конкурент: '+d.competitor,
  d.competitorSite&&'Сайт конкурента: '+d.competitorSite,
  d.service&&'Услуга: '+d.service,d.channel&&'Способ ответа: '+d.channel,
  'Задача: '+d.task,d.original&&'Оригинальное сообщение: '+d.original,
  d.questions&&'Запросы: '+d.questions,d.productLinks&&'Ссылки на товары: '+d.productLinks,
  'Получено: '+record.createdAt
 ].filter(Boolean).join('\n');
 if(msg.length>4090)return {ok:false,error:'Заявка слишком длинная для Telegram; сохранена для обработки'};
 try{
  const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({chat_id:chat,text:msg,disable_web_page_preview:true}),
   signal:AbortSignal.timeout(12000)
  });
  const responseBody=await response.json().catch(()=>null);
  if(response.ok&&responseBody?.ok===true)return {ok:true};
  return {ok:false,error:'Telegram не подтвердил доставку'};
 }catch{return {ok:false,error:'Нет соединения с Telegram'};}
}
export async function acceptLead(store,body,type,opts={}){
 const payload=parseLead(body,type);
 const receipt=safeId(body.requestId)||randomUUID();
 const location=key(receipt);
 let record=await store.get(location,{type:'json',consistency:'strong'});
 if(record&&record.type!==type)throw Error('Некорректный идентификатор заявки.');
 if(!record){
  record={id:receipt,type,payload,createdAt:time(),state:'notification_pending',attempts:0,notifiedAt:null,lastError:null};
  await store.setJSON(location,record);
  // Read back the stored record; no success is returned unless persistence completed.
  record=await store.get(location,{type:'json',consistency:'strong'});
  if(!record||record.id!==receipt)throw Error('Хранилище не подтвердило сохранение заявки.');
 }
 const attempt=opts.notify!==false&&record.state!=='notified';
 if(attempt){
  const result=await notifyTelegram(record,opts);
  record={...record,attempts:record.attempts+1,lastTriedAt:time(),
   state:result.ok?'notified':'notification_pending',
   notifiedAt:result.ok?time():null,lastError:result.ok?null:result.error};
  // An update failure must not hide that the first durable write succeeded.
  try{await store.setJSON(location,record);}catch{return {saved:true,id:receipt,notification:'pending',warning:'Сохранено; требуется повторная доставка уведомления.'};}
 }
 return {saved:true,id:receipt,notification:record.state==='notified'?'sent':'pending'};
}
export async function dispatchPending(store,{max=30,fetcher=fetch,env=process.env}={}){
 let count=0,sent=0,errors=0,cursor;
 do{
  const listed=await store.list({prefix:'leads/',...(cursor?{cursor}:{})});
  cursor=listed.cursor;
  for(const item of listed.blobs||[]){
   if(count>=max)break;
   let record=await store.get(item.key,{type:'json',consistency:'strong'});
   if(!record||record.state==='notified')continue;
   count++;
   const res=await notifyTelegram(record,{fetcher,env});
   record={...record,attempts:(record.attempts||0)+1,lastTriedAt:time(),
     state:res.ok?'notified':'notification_pending',
     notifiedAt:res.ok?time():null,lastError:res.ok?null:res.error};
   await store.setJSON(item.key,record);
   if(res.ok)sent++;else errors++;
  }
 }while(cursor&&count<max);
 return {attempted:count,delivered:sent,pending:errors};
}
