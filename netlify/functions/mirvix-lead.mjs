import {acceptLead,leadStore,reply,sameOrigin} from '../lib/mirvix-lead-outbox.mjs';
export default async function handler(request){
 if(request.method!=='POST')return reply({error:'Разрешён только POST.'},405);
 if(!sameOrigin(request))return reply({error:'Недопустимый источник запроса.'},403);
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return reply({error:'Ожидается JSON.'},415);
 if(Number(request.headers.get('content-length'))>12000)return reply({error:'Слишком большая заявка.'},413);
 try{
  const raw=await request.text();
  if(raw.length>12000)return reply({error:'Слишком большая заявка.'},413);
  const body=JSON.parse(raw);
  if(body?.website||body?.extra_url)return reply({saved:false,error:'Неверные поля заявки.'},422);
  const type=['general','mira','ai-check'].includes(body.type)?body.type:'general';
  const result=await acceptLead(leadStore(),body,type);
  return reply({...result,submitted:result.saved,delivered:result.saved,
   message:result.notification==='sent'?'Заявка сохранена и передана специалистам.':
    'Заявка сохранена под номером '+result.id+'. Уведомление сотрудникам ожидает повторной отправки.'},202);
 }catch(e){
  const msg=String(e?.message||'Ошибка записи').slice(0,180);
  return reply({saved:false,error:/хранилищ|store|blob|network|fetch/i.test(msg)?
   'Заявка пока не сохранена. Повторите отправку; подтверждения не было.':msg},422);
 }
}
export const config={path:'/api/mirvix-lead',rateLimit:{windowLimit:4,windowSize:60,aggregateBy:['ip','domain']}};
