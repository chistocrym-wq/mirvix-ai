import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';

export const TOOL_PRICES=Object.freeze({
  competitor_1:{label:'1 конкурент · до 2 карточек',rub:490,max:1},
  competitor_3:{label:'до 3 конкурентов · до 4 карточек',rub:990,max:3},
  competitor_5:{label:'до 5 конкурентов · до 6 карточек',rub:1990,max:5}
});
export const COOKIE='__Host-mirvix_tools_visitor';
const STORE='mirvix-tools-access-v1';
const hash=(input)=>createHash('sha256').update(String(input)).digest('hex');
const secret=()=>process.env.MIRVIX_TOOLS_SESSION_SECRET||'';
export const toolsConfigured=()=>secret().length>=32;
export const paymentsConfigured=()=>toolsConfigured()&&
 process.env.MIRVIX_TOOLS_PAYMENTS_ENABLED==='1'&&
 !!process.env.YOOKASSA_SHOP_ID&&!!process.env.YOOKASSA_SECRET_KEY&&
 !!process.env.MIRVIX_TOOLS_VAT_CODE;
export const store=()=>getStore(STORE);
function sign(id){return createHmac('sha256',secret()).update(id).digest('base64url')}
function getCookie(headers){
 const raw=headers?.cookie||headers?.Cookie||'';
 const pair=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 return pair?pair.slice(COOKIE.length+1):'';
}
export function identify(event){
 if(!toolsConfigured())throw Error('Демо ещё не настроено: требуется MIRVIX_TOOLS_SESSION_SECRET (32+ символа).');
 const value=getCookie(event.headers);
 const parts=value.split('.');
 if(parts.length===2&&/^[a-f0-9]{48}$/.test(parts[0])&&/^[A-Za-z0-9_-]+$/.test(parts[1])){
   const expected=sign(parts[0]);
   if(expected.length===parts[1].length&&timingSafeEqual(Buffer.from(expected),Buffer.from(parts[1])))
     return {id:parts[0],cookie:null};
 }
 const id=randomBytes(24).toString('hex');
 return {id,cookie:COOKIE+'='+id+'.'+sign(id)+'; Secure; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000'};
}
export const bodyLimit=(event,max=15000)=>Buffer.byteLength(event.body||'')<=max;
export function sameOrigin(event){
 const origin=event.headers?.origin||event.headers?.Origin;
 if(!origin)return false;
 try{
  const url=new URL(origin);
  const host=event.headers?.host||event.headers?.Host;
  return url.protocol==='https:'&&url.host===host;
 }catch{return false}
}
export const keyFor=(prefix,visitor,tool)=>prefix+'/'+hash(visitor+'/'+tool);
export async function claimPreview(visitor,tool){
 const result=await store().setJSON(keyFor('preview',visitor,tool),
  {usedAt:new Date().toISOString(),tool},{onlyIfNew:true});
 return !!result.modified;
}
export function statusResponse(statusCode,data,cookie){
 return {statusCode,headers:{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  ...(cookie?{'set-cookie':cookie}:{})},body:JSON.stringify(data)};
}
export function packageForRivals(count){
 if(count===1)return 'competitor_1';
 if(count>=2&&count<=3)return 'competitor_3';
 if(count>=4&&count<=5)return 'competitor_5';
 return null;
}
export async function getOrder(orderId,visitor){
 if(typeof orderId!=='string'||!/^[a-f0-9-]{36}$/.test(orderId))return null;
 const order=await store().get('orders/'+orderId,{type:'json',consistency:'strong'});
 return order?.visitorHash===hash(visitor)?order:null;
}
export async function markConsumed(order){
 const result=await store().setJSON('redeemed/'+order.id,
  {orderId:order.id,tool:order.tool,at:new Date().toISOString()},
  {onlyIfNew:true});
 return !!result.modified;
}
export async function verifyPayment(order){
 const credentials=process.env.YOOKASSA_SHOP_ID+':'+process.env.YOOKASSA_SECRET_KEY;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('https://api.yookassa.ru/v3/payments/'+encodeURIComponent(order.paymentId),{
   method:'GET',headers:{Authorization:'Basic '+Buffer.from(credentials).toString('base64'),
    Accept:'application/json'},signal:controller.signal,redirect:'error'
  });
  if(!response.ok)throw Error('Не удалось проверить платёж в ЮKassa (HTTP '+response.status+').');
  const data=await response.json();
  return data.status==='succeeded'&&data.paid===true&&data.id===order.paymentId&&
   data.metadata?.mirvix_order_id===order.id&&
   data.amount?.currency==='RUB'&&
   Number(data.amount?.value)===TOOL_PRICES[order.packageId]?.rub;
 }finally{clearTimeout(timer)}
}
export const _test={hash,sign,getCookie};
