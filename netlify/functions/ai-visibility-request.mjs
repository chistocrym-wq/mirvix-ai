// Open AI visibility request: persist before notifying, no paid AI calls.
import {acceptLead,leadStore,reply,sameOrigin} from '../lib/mirvix-lead-outbox.mjs';
export default async function handler(request){
 if(request.method!=='POST')return reply({error:'POST only'},405);
 if(!sameOrigin(request))return reply({error:'Недопустимый источник запроса.'},403);
 try{
  const raw=await request.text();if(raw.length>11000)return reply({error:'Слишком длинная заявка.'},413);
  const body=JSON.parse(raw);
  if(body.extra_url)return reply({submitted:false,error:'Неверная заявка.'},422);
  const result=await acceptLead(leadStore(),body,'ai-check');
  return reply({...result,submitted:result.saved,message:result.notification==='sent'?
   'Заявка сохранена и передана специалистам.':'Заявка сохранена. Уведомление ожидает повторной отправки.'},202);
 }catch(error){
  return reply({submitted:false,error:String(error?.message||'Не удалось сохранить заявку.').slice(0,220)},422);
 }
}
export const config={path:'/api/ai-visibility-request',rateLimit:{windowLimit:3,windowSize:60,aggregateBy:['ip','domain']}};
