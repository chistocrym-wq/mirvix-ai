import {isStaffRequest} from '../lib/cabinet-session.mjs';
import {leadStore,notifyTelegram,reply,sameOrigin} from '../lib/mirvix-lead-outbox.mjs';

export default async function handler(request){
 if(request.method!=='POST')return reply({error:'POST only'},405);
 if(!sameOrigin(request))return reply({error:'Origin mismatch'},403);
 const url=new URL(request.url);
 const headers={...Object.fromEntries(request.headers.entries()),host:url.host};
 if(!isStaffRequest({headers}))return reply({error:'Войдите в кабинет сотрудника.'},403);
 try{
  const body=await request.json();
  const store=leadStore();
  if(body.action==='list'){
   const {blobs=[]}=await store.list({prefix:'leads/'});
   const ids=blobs.slice(-100).map(x=>x.key);
   const rows=(await Promise.all(ids.map(k=>store.get(k,{type:'json',consistency:'strong'})))).filter(Boolean);
   return reply({leads:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,80).map(x=>({
    id:x.id,name:x.payload.name,contact:x.payload.contact,task:x.payload.task.slice(0,200),
    type:x.type,createdAt:x.createdAt,state:x.state,attempts:x.attempts,notifiedAt:x.notifiedAt,
    lastError:x.lastError
   }))});
  }
  if(body.action==='retry'){
   if(typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{14,90}$/.test(body.id))return reply({error:'Неверный ID.'},422);
   const path='leads/'+body.id;
   let item=await store.get(path,{type:'json',consistency:'strong'});
   if(!item)return reply({error:'Заявка не найдена.'},404);
   if(item.state==='notified')return reply({alreadyNotified:true});
   const result=await notifyTelegram(item);
   item={...item,attempts:(item.attempts||0)+1,lastTriedAt:new Date().toISOString(),
     state:result.ok?'notified':'notification_pending',lastError:result.ok?null:result.error,
     notifiedAt:result.ok?new Date().toISOString():null};
   await store.setJSON(path,item);
   return reply({saved:true,notification:item.state});
  }
  return reply({error:'Неизвестное действие.'},400);
 }catch{return reply({error:'Не удалось прочитать серверный журнал.'},503);}
}
export const config={path:'/api/mirvix-leads-admin'};
