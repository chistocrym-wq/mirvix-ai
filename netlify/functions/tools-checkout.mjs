import {randomUUID,createHash} from 'node:crypto';
import {identify,sameOrigin,statusResponse,TOOL_PRICES,paymentsConfigured,toolsConfigured,
  packageForRivals,store,getOrder,verifyPayment} from '../lib/tools-access.mjs';

const digest=urls=>createHash('sha256').update(JSON.stringify(urls)).digest('hex');
const validEmail=s=>typeof s==='string'&&s.length<=180&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export async function handler(event){
 if(event.httpMethod!=='POST')return statusResponse(405,{error:'Нужен POST.'});
 if(!sameOrigin(event))return statusResponse(403,{error:'Запрос должен быть отправлен с сайта MIRVIX.'});
 if(Buffer.byteLength(event.body||'')>14000)return statusResponse(413,{error:'Запрос слишком большой.'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return statusResponse(400,{error:'Неверный JSON.'})}
 if(!toolsConfigured())return statusResponse(503,{error:'Серверный режим пробных проверок ещё не настроен.'});
 let visitor;try{visitor=identify(event)}catch{return statusResponse(503,{error:'Пробные проверки временно не настроены.'})}
 const respond=(code,data)=>statusResponse(code,data,visitor.cookie);
 if(body.action==='config'){
  return respond(200,{paymentsEnabled:paymentsConfigured(),
   previewPolicy:'Одна ограниченная проверка каждого работающего инструмента на браузер. Очистка cookie может сбросить ограничение; для строгого контроля потребуется аккаунт.',
   prices:TOOL_PRICES});
 }
 if(body.action==='checkout'){
  if(!paymentsConfigured())return respond(503,{error:'Оплата ещё не подключена. Мы не принимаем платежи, пока не настроены ЮKassa и фискализация.'});
  const urls=body.urls;
  const count=Array.isArray(urls)?urls.length-1:0;
  const packageId=packageForRivals(count);
  if(!packageId||!Array.isArray(urls)||urls.some(u=>typeof u!=='string'||u.length>1200||!/^https:\/\/[^?#]+$/i.test(u)))
   return respond(422,{error:'Нужны HTTPS-ссылки на свой товар и 1–5 конкурентов.'});
  if(!validEmail(body.email))return respond(422,{error:'Укажите email для чека и подтверждения покупки.'});
  const price=TOOL_PRICES[packageId].rub;
  const vatCode=Number(process.env.MIRVIX_TOOLS_VAT_CODE);
  if(!Number.isInteger(vatCode)||vatCode<1||vatCode>20)
   return respond(503,{error:'Не настроен код НДС для чеков ЮKassa.'});
  const id=randomUUID(),order={id,visitorHash:createHash('sha256').update(visitor.id).digest('hex'),
   tool:'competitor-products',packageId,urlsHash:digest(urls),createdAt:Date.now()};
  const saved=await store().setJSON('orders/'+id,order,{onlyIfNew:true});
  if(!saved.modified)return respond(409,{error:'Заказ уже существует.'});
  const payload={
   amount:{value:price.toFixed(2),currency:'RUB'},
   capture:true,
   confirmation:{type:'redirect',return_url:'https://mirvixai.com/tools/?order_id='+encodeURIComponent(id)+'#compare'},
   description:'MIRVIX: сравнение товаров конкурентов, '+count+' шт.',
   metadata:{mirvix_order_id:id,product:'competitor-products'},
   receipt:{customer:{email:body.email},items:[{
     description:'Разовый анализ '+count+' конкурентов',
     quantity:'1.00',amount:{value:price.toFixed(2),currency:'RUB'},
     vat_code:vatCode,payment_mode:'full_payment',payment_subject:'service'
   }]}
  };
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const token=Buffer.from(process.env.YOOKASSA_SHOP_ID+':'+process.env.YOOKASSA_SECRET_KEY).toString('base64');
   const response=await fetch('https://api.yookassa.ru/v3/payments',{
    method:'POST',signal:controller.signal,redirect:'error',
    headers:{'Content-Type':'application/json','Accept':'application/json',
      'Authorization':'Basic '+token,'Idempotence-Key':id},
    body:JSON.stringify(payload)
   });
   const payment=await response.json().catch(()=>null);
   if(!response.ok||!payment?.id||!payment?.confirmation?.confirmation_url)
    return respond(502,{error:'Не удалось создать платёж в ЮKassa. Деньги не списаны; обратитесь в поддержку.'});
   const confirmation=new URL(payment.confirmation.confirmation_url);
   if(confirmation.protocol!=='https:')throw Error('Небезопасный адрес оплаты.');
   order.paymentId=payment.id;
   await store().setJSON('orders/'+id,order);
   return respond(200,{orderId:id,confirmationUrl:confirmation.href,priceRub:price});
  }catch{return respond(502,{error:'Платёжный сервис недоступен. Деньги с этой страницы не списывались.'})}
  finally{clearTimeout(timer)}
 }
 if(body.action==='payment-status'){
  const order=await getOrder(body.orderId,visitor.id);
  if(!order)return respond(404,{error:'Платёж не найден в текущем браузере.'});
  const valid=paymentsConfigured()?await verifyPayment(order):false;
  return respond(200,{paid:valid,orderId:order.id,packageId:order.packageId,
    description:valid?'Оплата подтверждена. Можно запустить одну полную проверку.':'Оплата пока не подтверждена.'});
 }
 return respond(400,{error:'Неизвестная операция.'});
}
export const _test={digest,validEmail};
