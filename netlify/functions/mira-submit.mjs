// MIRA contact transfer requires explicit contact-specific consent.
import {acceptLead,leadStore,reply,sameOrigin} from '../lib/mirvix-lead-outbox.mjs';
export default async function handler(request){
 if(request.method==='GET')return reply({deliveryConfigured:true,persistedInbox:true});
 if(request.method!=='POST')return reply({error:'POST only'},405);
 if(!sameOrigin(request))return reply({error:'Недопустимый источник запроса.'},403);
 try{
  const raw=await request.text();if(raw.length>11000)return reply({error:'Слишком длинное обращение.'},413);
  const data=JSON.parse(raw);
  if(data.website)return reply({delivered:false,error:'Неверная заявка.'},422);
  const body={...data,name:data.name||'Посетитель MIRVIX',task:data.task||data.original,contact:data.contact,
   consent:data.consent,type:'mira'};
  const result=await acceptLead(leadStore(),body,'mira');
  return reply({...result,delivered:result.saved,message:result.notification==='sent'?
   'Обращение сохранено и передано.':'Обращение сохранено; уведомление специалисту будет повторено.'},202);
 }catch(error){
  return reply({delivered:false,error:String(error?.message||'Не удалось сохранить обращение.').slice(0,220)},422);
 }
}
export const config={path:'/api/mira-submit',rateLimit:{windowLimit:3,windowSize:60,aggregateBy:['ip','domain']}};
