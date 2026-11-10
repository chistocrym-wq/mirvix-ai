(()=>{
'use strict';
const $=id=>document.getElementById(id);
const form=$('compare-form'),container=$('competitor-inputs'),add=$('add-competitor'),out=$('compare-output');
if(!form||!container||!add||!out)return;
let current=null;
let paymentsEnabled=false,activeOrder=null,paidVerified=false;
const priceForCount=count=>count<=1?490:count<=3?990:1990;
const setPurchaseStatus=(msg,state='info')=>{const el=$('purchase-status');el.textContent=msg;el.dataset.state=state;};
const priceLabel=()=>{const n=container.querySelectorAll('input').length;$('purchase-price').textContent=priceForCount(n).toLocaleString('ru-RU')+' ₽';};
const urlsForForm=()=>[validateUrl($('own-product').value),...[...container.querySelectorAll('input')].map(i=>validateUrl(i.value))];
const elem=(tag,text,cls)=>{
  const el=document.createElement(tag);
  if(text!==undefined&&text!==null)el.textContent=String(text);
  if(cls)el.className=cls;
  return el;
};
const fmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const stock={in_stock:'В наличии (по данным карточки)',out_of_stock:'Нет в наличии (по данным карточки)',preorder:'Предзаказ (по данным карточки)'};
function setStatus(message,state='info'){
  const node=$('compare-status');
  node.textContent=message;node.dataset.state=state;
}
function refresh(){
  const entries=[...container.querySelectorAll('.competitor-entry')];
  entries.forEach((row,index)=>{
    const label=row.querySelector('label'),input=row.querySelector('input');
    input.id='competitor-'+index;
    label.htmlFor=input.id;label.textContent='Конкурент '+(index+1);
    const remove=row.querySelector('button.remove');
    if(remove){remove.hidden=entries.length===1;}
  });
  $('competitor-count').textContent=entries.length+' из 5';
  add.disabled=entries.length>=5;
  priceLabel();
}
function buildRow(){
  const row=elem('div',null,'competitor-entry');
  const lab=elem('label','Конкурент');const input=elem('input');
  input.type='url';input.required=true;input.name='competitor';input.maxLength=1200;
  input.inputMode='url';input.placeholder='https://сайт-конкурента.ru/product/...';
  const remove=elem('button','×','remove');remove.type='button';
  remove.setAttribute('aria-label','Удалить конкурента');
  remove.addEventListener('click',()=>{row.remove();refresh();});
  row.append(lab,input,remove);return row;
}
add.addEventListener('click',()=>{
  if(container.children.length>=5)return;
  const row=buildRow();container.appendChild(row);refresh();
  row.querySelector('input')?.focus();
});
refresh();
function money(row){
  if(row.price===null||row.price===undefined)return 'Цена не найдена';
  const currency=row.currency==='RUB'?'₽':row.currency==='USD'?'$':
    row.currency==='EUR'?'€':row.currency==='KZT'?'₸':row.currency||'валюта неизвестна';
  return fmt.format(row.price)+' '+currency;
}
function renderCard(row){
  const card=elem('article',null,'product-card'+(row.index===0?' is-own':''));
  const picture=elem('div',null,'product-image');
  picture.appendChild(elem('span',row.index===0?'Ваш товар':'Конкурент '+row.index,'product-label'));
  if(row.ok&&row.image){
    const image=elem('img');
    image.src=row.image;image.alt=row.title||'Фото товара';image.loading='lazy';
    image.referrerPolicy='no-referrer';
    image.addEventListener('error',()=>image.replaceWith(elem('div','▧','placeholder-image')),{once:true});
    picture.appendChild(image);
  }else picture.appendChild(elem('div','▧','placeholder-image'));
  card.appendChild(picture);
  const details=elem('div',null,'product-details');
  let host='Источник';
  try{host=new URL(row.url).hostname;}catch{}
  details.appendChild(elem('div',host,'product-host'));
  details.appendChild(elem('div',row.ok?row.title:'Карточка не прочитана','product-title'));
  details.appendChild(elem('div',row.ok?money(row):'Нет данных','product-price'+
    (!row.ok||row.price===null?' unavailable':'')));
  details.appendChild(elem('div',row.ok?(stock[row.availability]||'Наличие не указано'):'Проверка не выполнена','stock'));
  if(row.ok){
    const q=elem('div',null,'quality-label');
    q.append(elem('span','Полнота карточки'),elem('b',(row.completeness||0)+'%'));
    details.appendChild(q);
    const track=elem('div',null,'quality-track');const bar=elem('i');
    bar.style.width=Math.min(100,Math.max(0,Number(row.completeness)||0))+'%';
    track.appendChild(bar);details.appendChild(track);
    const confirmed=[];
    if(row.sku)confirmed.push('Артикул: '+row.sku);
    if(row.brand)confirmed.push('Бренд: '+row.brand);
    if(row.evidence?.price)confirmed.push('Цена: '+row.evidence.price);
    if(!row.schemaConfirmed)confirmed.push('Тип товара не подтверждён разметкой Product');
    if(row.missing?.length)confirmed.push('Не найдено: '+row.missing.join(', '));
    if(confirmed.length)details.appendChild(elem('div',confirmed.join(' · '),'product-spec'));
  }else details.appendChild(elem('div',row.error||'Сайт не вернул данные.','product-error'));
  const link=elem('a','Открыть исходную карточку ↗','source');
  link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';
  details.appendChild(link);card.appendChild(details);
  return card;
}
function findings(data){
  const element=$('compare-findings');element.replaceChildren();
  element.appendChild(elem('h4','Что удалось подтвердить'));
  const ul=elem('ul');
  const own=data.pages[0],ok=data.successful,prices=data.completePrices;
  ul.appendChild(elem('li','Прочитано '+ok+' из '+data.pages.length+' карточек. Подтверждённые цены найдены для '+prices+'.'));
  if(!own?.ok)ul.appendChild(elem('li','Свою карточку не удалось прочитать, поэтому сравнение цен невозможно.'));
  const comps=data.comparisons||[];
  for(const compare of comps){
    const row=data.pages[compare.index];
    let msg='Конкурент '+compare.index+': ';
    if(compare.comparable){
      const abs=Math.abs(compare.deltaPercent);
      msg+=compare.deltaPercent>0?'цена выше вашей на '+fmt.format(abs)+'%':
        compare.deltaPercent<0?'цена ниже вашей на '+fmt.format(abs)+'%':
        'цены одинаковые';
      msg+=' (совпадающий SKU и валюта).';
    }else msg+='числовое сравнение не выполнено. '+(compare.reason||'Нельзя подтвердить идентичность товаров.');
    if(row?.ok && row.missing?.length)msg+=' В карточке не найдены: '+row.missing.join(', ')+'.';
    ul.appendChild(elem('li',msg));
  }
  ul.appendChild(elem('li','Оценка полноты считает наличие восьми полей, а не качество текста или фотографий. Для содержательной оценки нужен отдельный анализ.'));
  element.appendChild(ul);
}
function render(data){
  current=data;
  const isPreview=data.access==='preview'||data.preview===true;
  $('export-csv').hidden=isPreview;
  $('compare-findings').hidden=isPreview;
  const gallery=$('product-cards');gallery.replaceChildren();
  for(const row of data.pages)gallery.appendChild(renderCard(row));
  $('result-summary').textContent='По состоянию на '+new Date(data.checkedAt).toLocaleString('ru-RU')+
    ' · '+data.successful+' подтверждённых страниц из '+data.pages.length+'.';
  if(!isPreview)findings(data);
  else{$('compare-findings').replaceChildren();}
  out.hidden=false;
  out.scrollIntoView({behavior:'smooth',block:'start'});
}
function validateUrl(raw){
  const v=String(raw||'').trim();
  let url;try{url=new URL(v);}catch{throw Error('Вставьте полную ссылку https:// на каждую карточку товара.');}
  if(url.protocol!=='https:'||!url.hostname.includes('.')||url.username||url.password||url.port||url.hash)
    throw Error('Нужны публичные HTTPS-ссылки без паролей, портов и фрагментов.');
  if(url.search)throw Error('Уберите параметры после «?» в ссылках — так мы не передадим токены сайтов.');
  return url.href;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const btn=$('compare-submit');
  if(btn.disabled)return;
  let urls;
  try{
    urls=urlsForForm();
    if(new Set(urls).size!==urls.length)throw Error('Нужны разные ссылки на товары.');
  }catch(error){setStatus(error.message,'error');return;}
  btn.disabled=true;btn.textContent='Проверяю карточки…';
  out.hidden=true;current=null;
  setStatus('Читаю публичные карточки. Для каждого сайта проверяю наличие цены, изображения и характеристик…');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),59000);
  try{
    const response=await fetch('/.netlify/functions/competitor-products',{
      method:'POST',headers:{'Content-Type':'application/json'},
      signal:controller.signal,credentials:'same-origin',body:JSON.stringify({action:'compare',mode:'preview',urls})
    });
    let data;try{data=await response.json()}catch{throw Error('Сервис вернул некорректный ответ.');}
    if(!response.ok)throw Error(data.error||'Сервис временно недоступен (HTTP '+response.status+').');
    if(!Array.isArray(data.pages))throw Error('Ответ не содержит карточек товаров.');
    render(data);
    setStatus('Ознакомительный просмотр получен. Показан только 1 конкурент без полной аналитики и CSV. Остальные данные доступны после покупки.','success');
  }catch(error){
    setStatus(error.name==='AbortError'?'Не удалось завершить проверку за 59 секунд. Попробуйте меньше конкурентов.':
      'Не удалось получить сравнение: '+error.message,'error');
  }finally{clearTimeout(timeout);btn.disabled=false;btn.textContent='Посмотреть часть результата бесплатно ↗';}
});

async function checkoutRequest(payload){
 const response=await fetch('/.netlify/functions/tools-checkout',{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload)
 });
 const data=await response.json().catch(()=>({error:'Сервер вернул нечитабельный ответ.'}));
 if(!response.ok)throw Error(data.error||'Ошибка HTTP '+response.status);
 return data;
}
async function loadPaymentConfig(){
 try{
  const config=await checkoutRequest({action:'config'});
  paymentsEnabled=!!config.paymentsEnabled;
  const btn=$('purchase-submit');btn.disabled=!paymentsEnabled;
  if(paymentsEnabled)setPurchaseStatus('Платёжная система готова. Выберите товары и укажите email для чека.','success');
  else setPurchaseStatus('Оплата пока подключается. Полный отчёт купить нельзя, пока мы не настроили приём платежей и выдачу чека.');
  const orderId=new URL(location.href).searchParams.get('order_id');
  if(orderId&&/^[a-f0-9-]{36}$/.test(orderId)){
   activeOrder=orderId;
   $('payment-check').hidden=false;
   const saved=sessionStorage.getItem('mirvix_tools_pending_order_v1');
   if(saved){
    try{
      const record=JSON.parse(saved);
      if(record.id===orderId&&Array.isArray(record.urls)){
       $('own-product').value=record.urls[0]||'';
       container.replaceChildren();
       for(const url of record.urls.slice(1,6)){
        const row=buildRow();row.querySelector('input').value=url;container.appendChild(row);
       }
       refresh();
       if(record.email)$('buyer-email').value=record.email;
      }
    }catch{/* Ignore corrupt browser state. */}
   }
   await checkPayment();
  }
 }catch(error){paymentsEnabled=false;$('purchase-submit').disabled=true;
   setPurchaseStatus('Покупка пока недоступна: '+error.message,'error');}
}
async function checkPayment(){
 if(!activeOrder){setPurchaseStatus('Не найден номер заказа.','error');return;}
 $('payment-check').hidden=false;
 try{
  const result=await checkoutRequest({action:'payment-status',orderId:activeOrder});
  paidVerified=!!result.paid;
  $('run-paid').hidden=!paidVerified;
  setPurchaseStatus(result.description,paidVerified?'success':'info');
 }catch(error){paidVerified=false;setPurchaseStatus('Проверка платежа: '+error.message,'error');}
}
$('payment-check').addEventListener('click',checkPayment);
$('purchase-submit').addEventListener('click',async()=>{
 if(!paymentsEnabled)return;
 let urls;try{urls=urlsForForm();if(new Set(urls).size!==urls.length)throw Error('Повторяющиеся адреса товаров.');}
 catch(error){setPurchaseStatus(error.message,'error');return;}
 const email=$('buyer-email').value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setPurchaseStatus('Укажите действующий email для получения чека.','error');return;}
 const button=$('purchase-submit');button.disabled=true;
 setPurchaseStatus('Создаю заказ в ЮKassa. Пока никаких списаний не произошло.');
 try{
  const response=await checkoutRequest({action:'checkout',urls,email});
  sessionStorage.setItem('mirvix_tools_pending_order_v1',JSON.stringify({id:response.orderId,urls,email}));
  const payment=new URL(response.confirmationUrl);
  if(payment.protocol!=='https:')throw Error('Небезопасный адрес оплаты.');
  location.assign(payment.href);
 }catch(error){setPurchaseStatus('Не удалось начать оплату: '+error.message,'error');button.disabled=false;}
});
$('run-paid').addEventListener('click',async()=>{
 if(!paidVerified||!activeOrder)return;
 let urls;try{urls=urlsForForm();}
 catch(error){setPurchaseStatus(error.message,'error');return;}
 const button=$('run-paid');button.disabled=true;
 setPurchaseStatus('Платёж подтверждён. Получаю полные карточки и расчёты…');
 try{
  const response=await fetch('/.netlify/functions/competitor-products',{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'compare',mode:'full',urls,orderId:activeOrder})
  });
  const data=await response.json().catch(()=>({error:'Некорректный ответ.'}));
  if(!response.ok)throw Error(data.error||'HTTP '+response.status);
  render(data);
  setPurchaseStatus('Полный отчёт получен. Сохраните CSV. Эта покупка включает одну полную проверку.','success');
  sessionStorage.removeItem('mirvix_tools_pending_order_v1');
  paidVerified=false;$('payment-check').hidden=true;
 }catch(error){setPurchaseStatus('Не удалось получить оплаченный отчёт: '+error.message+'. Если платёж подтверждён, обратитесь в поддержку с номером заказа.','error');}
 finally{button.disabled=false;}
});
loadPaymentConfig();

const csv=(value)=>{const raw=String(value??'').replace(/[\r\n]+/g,' ');const safe=/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';};
$('export-csv').addEventListener('click',()=>{
  if(!current||current.preview||current.access==='preview')return;
  const rows=[['Роль','Сайт','Название','Цена','Валюта','Наличие','SKU','Бренд','Полнота %','Фото URL','URL товара','Ошибка']];
  for(const p of current.pages)rows.push([
    p.index===0?'Мой товар':'Конкурент '+p.index,
    p.host||'',p.title||'',p.price??'',p.currency||'',p.availability||'',p.sku||'',
    p.brand||'',p.completeness??'',p.image||'',p.url,p.error||''
  ]);
  const content='\uFEFF'+rows.map(row=>row.map(csv).join(';')).join('\r\n');
  const file=new Blob([content],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(file),link=elem('a');link.href=url;
  link.download='mirvix-competitors-'+new Date().toISOString().slice(0,10)+'.csv';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
})();
