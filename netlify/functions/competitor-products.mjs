import { _test as audit } from './site-audit.mjs';

const HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};
const send=(statusCode,data)=>({statusCode,headers:HEADERS,body:JSON.stringify(data)});
const text=(v,max=250)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const first=(...items)=>items.find(x=>x!==null&&x!==undefined&&x!=='')??null;
const ent=(s)=>String(s||'').replace(/&quot;|&#34;/gi,'"').replace(/&apos;|&#39;/gi,"'")
  .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/&nbsp;|&#160;/gi,' ');
const strip=(s)=>text(ent(String(s||'').replace(/<[^>]*>/g,' ')),600);
const norm=(s)=>text(s,200).toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function validUrl(input){
  if(typeof input!=='string'||input.length>1200||!input.trim())throw Error('Укажите ссылку на публичную HTTPS-карточку товара.');
  let url;try{url=new URL(input.trim());}catch{throw Error('Ссылка не распознана. Нужен полный адрес https://…');}
  // The pinned HTTPS reader also rejects local IPs, internal hostnames, DNS rebinding and off-domain redirects.
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
    !/^[a-z0-9.-]+$/i.test(url.hostname)||!url.hostname.includes('.')||
    /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)||
    /\.(?:local|internal|localhost|test|invalid|example)$/i.test(url.hostname))throw Error('Разрешены только обычные публичные HTTPS-сайты.');
  // Do not send arbitrary query strings (can contain credentials) to a third-party destination.
  if(url.search)throw Error('Удалите параметры после ? из URL и повторите проверку.');
  return url;
}
function tags(html,tag){
  const re=new RegExp('<'+tag+'\\b[^>]*>','gi');
  return [...html.matchAll(re)].slice(0,150).map(m=>m[0]);
}
function attrs(t){
  const out={};
  for(const m of t.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    out[m[1].toLowerCase()]=ent(m[2]??m[3]??m[4]??'');
  return out;
}
function metas(html){
  const output={};
  for(const tag of tags(html,'meta')){
    const a=attrs(tag),key=(a.property||a.name||a.itemprop||'').toLowerCase();
    if(key&&!output[key])output[key]=a.content||'';
  }
  return output;
}
function schemas(html){
  const nodes=[];
  const maxBlocks=25;
  let n=0;
  for(const m of html.matchAll(/<script\b(?=[^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)){
    if(++n>maxBlocks)break;
    if(m[1].length>300000)continue;
    try{
      const parsed=JSON.parse(m[1].trim());
      const visit=(item,depth=0)=>{
        if(depth>7||nodes.length>110||!item||typeof item!=='object')return;
        if(Array.isArray(item)){for(const obj of item.slice(0,70))visit(obj,depth+1);return;}
        const kinds=[item['@type']].flat().map(v=>String(v||'').toLowerCase().split('/').pop());
        if(kinds.includes('product'))nodes.push(item);
        if(item['@graph'])visit(item['@graph'],depth+1);
        if(item.mainEntity)visit(item.mainEntity,depth+1);
        if(item.itemListElement)visit(item.itemListElement,depth+1);
        if(item.item)visit(item.item,depth+1);
      };
      visit(parsed);
    }catch{/* Invalid JSON-LD is simply not verified. */}
  }
  return nodes;
}
function imageUrl(value,base){
  const raw=typeof value==='string'?value:
    value?.url||value?.contentUrl||'';
  if(!raw||typeof raw!=='string')return null;
  try{
    const u=new URL(raw,base);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
       !u.hostname.includes('.')||!/^[-a-z0-9.]+$/i.test(u.hostname))return null;
    return u.href.slice(0,950);
  }catch{return null;}
}
function amount(raw){
  if(typeof raw==='number')return Number.isFinite(raw)&&raw>0&&raw<1e10?Number(raw):null;
  if(typeof raw!=='string')return null;
  let s=raw.replace(/[\s\u00a0]/g,'').replace(/[^\d,.]/g,'');
  if(!s)return null;
  const commas=(s.match(/,/g)||[]).length,dots=(s.match(/\./g)||[]).length;
  if(commas&&dots){
    const lastComma=s.lastIndexOf(','),lastDot=s.lastIndexOf('.');
    const decimal=lastComma>lastDot?',':'.';
    const thousand=decimal===','?'.':',';
    s=s.split(thousand).join('').replace(decimal,'.');
  }else if(commas){
    const last=s.lastIndexOf(','),tail=s.length-last-1;
    s=tail===1||tail===2?s.replace(/,/g,'.'):s.replace(/,/g,'');
  }else if(dots){
    const last=s.lastIndexOf('.'),tail=s.length-last-1;
    s=tail===1||tail===2?s:s.replace(/\./g,'');
  }
  const num=Number(s);
  return Number.isFinite(num)&&num>0&&num<1e10?num:null;
}
function availability(raw){
  const s=String(raw||'').toLowerCase();
  if(!s)return null;
  if(/outofstock|soldout|нет\s+в\s+наличии|распродано/.test(s))return 'out_of_stock';
  if(/instock|limitedavailability|в\s+наличии|доступно\s+к\s+заказу/.test(s))return 'in_stock';
  if(/preorder|предзаказ|под\s+заказ/.test(s))return 'preorder';
  return null;
}
function extract(html,pageUrl){
  const meta=metas(html),p=schemas(html)[0]||null;
  let offer=p&&first(p.offers?.[0],Array.isArray(p.offers)?null:p.offers);
  if(!offer||typeof offer!=='object')offer=null;
  const spec={};
  if(p&&Array.isArray(p.additionalProperty)){
    for(const row of p.additionalProperty.slice(0,25)){
      if(typeof row?.name==='string'&&(typeof row.value==='string'||typeof row.value==='number')){
        const name=text(row.name,75),value=text(String(row.value),110);
        if(name&&value)spec[name]=value;
      }
    }
  }
  const title=text(first(p?.name,meta['og:title'],strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1])),180);
  const desc=text(first(p?.description,meta['og:description'],meta.description),320);
  const sku=text(first(p?.sku,p?.mpn,p?.gtin13,p?.gtin14),100);
  const brand=typeof p?.brand==='string'?text(p.brand,100):text(p?.brand?.name,100);
  const offerPrice=first(offer?.price,offer?.priceSpecification?.price,
    meta['product:price:amount'],meta['og:price:amount']);
  const price=amount(offerPrice);
  const currency=text(first(offer?.priceCurrency,offer?.priceSpecification?.priceCurrency,
    meta['product:price:currency'],meta['og:price:currency']),8).toUpperCase()||null;
  const imgRaw=first(p?.image?.[0],p?.image,meta['og:image:secure_url'],meta['og:image']);
  const image=imageUrl(imgRaw,pageUrl);
  const stocked=availability(offer?.availability);
  const signals={
    productSchema:!!p,price:price!==null,image:!!image,description:!!desc,
    sku:!!sku,brand:!!brand,specifications:Object.keys(spec).length>0,
    availability:stocked!==null
  };
  const fields=[
    ['Название',!!title],['Фото товара',!!image],['Цена',price!==null],
    ['Описание',!!desc],['Артикул',!!sku],['Бренд',!!brand],
    ['Характеристики',Object.keys(spec).length>0],['Наличие',stocked!==null]
  ];
  return {title,description:desc,sku,brand,image,price,currency,availability:stocked,
    specifications:spec,signals,completeness:Math.round(100*fields.filter(x=>x[1]).length/fields.length),
    missing:fields.filter(x=>!x[1]).map(x=>x[0]),schemaConfirmed:!!p,
    // Schema.org or metadata evidence only. Never infer prices from arbitrary page text.
    evidence:{price:price!==null?(offer?'schema.org/Offer':'product metadata'):null,
      image:image?(p?.image?'schema.org/Product':'og:image'):null}};
}
function comparable(a,b){
  if(!a.price||!b.price)return {ok:false,reason:'Нет подтверждённой цены у одного из товаров.'};
  if(!a.currency||!b.currency||a.currency!==b.currency)return {ok:false,reason:'Валюты не подтверждены или различаются.'};
  if(a.sku&&b.sku&&norm(a.sku)===norm(b.sku))
    return {ok:true,method:'Совпал артикул / SKU'};
  return {ok:false,reason:'Не подтверждён одинаковый артикул: сравнение цен без приведения размеров и комплектаций было бы неточным.'};
}
async function inspectOne(url,index){
  const validated=validUrl(url);
  const result=await audit.getText(validated,600000,12500);
  if(result.status!==200){
    return {index,url:validated.href,ok:false,httpStatus:result.status,
      error:'Сайт вернул HTTP '+result.status+'. Данные не представлены как успешная проверка.'};
  }
  if(!/text\/html/i.test(result.headers.get('content-type')||'text/html')||
     !/<html\b|<head\b|<title\b/i.test(result.text)){
    return {index,url:validated.href,ok:false,httpStatus:result.status,error:'Это не HTML-карточка товара.'};
  }
  const data=extract(result.text,validated.href);
  if(!data.title&&!data.schemaConfirmed){
    return {index,url:validated.href,ok:false,httpStatus:result.status,
      error:'На странице не обнаружены данные товара.'};
  }
  return {index,url:validated.href,host:validated.hostname,ok:true,httpStatus:200,
    checkedAt:new Date().toISOString(),...data};
}
export async function handler(event){
  if(event.httpMethod!=='POST')return send(405,{error:'Нужен POST-запрос.'});
  if(Buffer.byteLength(event.body||'')>12500)return send(413,{error:'Слишком много данных.'});
  let request;try{request=JSON.parse(event.body||'{}')}catch{return send(400,{error:'Некорректные данные.'})}
  if(request.action!=='compare')return send(400,{error:'Неизвестная операция.'});
  const items=request.urls;
  if(!Array.isArray(items)||items.length<2||items.length>6)return send(422,{error:'Укажите ссылку на свой товар и от 1 до 5 ссылок конкурентов.'});
  let validated;
  try{
    validated=items.map(validUrl);
    if(new Set(validated.map(u=>u.href)).size!==validated.length)throw Error('Ссылки на товары должны различаться.');
  }catch(error){return send(422,{error:error.message});}
  const results=await Promise.allSettled(validated.map((item,index)=>inspectOne(item.href,index)));
  const rows=results.map((value,index)=>value.status==='fulfilled'?value.value:
    {index,url:validated[index].href,ok:false,error:text(value.reason?.message||'Не удалось получить страницу.',200)});
  const own=rows[0];
  const comparisons=rows.slice(1).map(item=>{
    const match=own.ok&&item.ok?comparable(own,item):{ok:false,reason:'Одна из карточек не прочитана.'};
    const delta=match.ok?(item.price-own.price)/own.price*100:null;
    return {index:item.index,comparable:match.ok,method:match.method||null,
      reason:match.reason||null,deltaPercent:delta===null?null:Math.round(delta*10)/10};
  });
  return send(200,{checkedAt:new Date().toISOString(),mode:'public-product-pages',
    disclaimer:'Показаны только данные, подтверждённые HTML/JSON-LD/метаданными. Нет доступа к JS-каталогам, авторизованным ценам и закрытым страницам. Цена не означает наличие. Сравнение цен разрешено только при совпадении SKU и валюты.',
    pages:rows,comparisons,successful:rows.filter(x=>x.ok).length,
    completePrices:rows.filter(x=>x.ok&&x.price!==null).length});
}
export const _test={validUrl,attrs,metas,schemas,imageUrl,amount,availability,extract,comparable};
