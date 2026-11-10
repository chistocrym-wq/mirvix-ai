(()=>{
'use strict';
const $=id=>document.getElementById(id);
const form=$('compare-form'),container=$('competitor-inputs'),add=$('add-competitor'),out=$('compare-output');
if(!form||!container||!add||!out)return;
let current=null;
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
  const gallery=$('product-cards');gallery.replaceChildren();
  for(const row of data.pages)gallery.appendChild(renderCard(row));
  $('result-summary').textContent='По состоянию на '+new Date(data.checkedAt).toLocaleString('ru-RU')+
    ' · '+data.successful+' подтверждённых страниц из '+data.pages.length+'.';
  findings(data);out.hidden=false;
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
    urls=[validateUrl($('own-product').value),...[...container.querySelectorAll('input')].map(i=>validateUrl(i.value))];
    if(new Set(urls).size!==urls.length)throw Error('Нужны разные ссылки на товары.');
  }catch(error){setStatus(error.message,'error');return;}
  btn.disabled=true;btn.textContent='Проверяю карточки…';
  out.hidden=true;current=null;
  setStatus('Читаю публичные карточки. Для каждого сайта проверяю наличие цены, изображения и характеристик…');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),59000);
  try{
    const response=await fetch('/.netlify/functions/competitor-products',{
      method:'POST',headers:{'Content-Type':'application/json'},
      signal:controller.signal,body:JSON.stringify({action:'compare',urls})
    });
    let data;try{data=await response.json()}catch{throw Error('Сервис вернул некорректный ответ.');}
    if(!response.ok)throw Error(data.error||'Сервис временно недоступен (HTTP '+response.status+').');
    if(!Array.isArray(data.pages))throw Error('Ответ не содержит карточек товаров.');
    render(data);
    setStatus('Готово. Проверено '+data.pages.length+' страниц. Если магазин закрыл цены от автоматического чтения, это указано на карточке.','success');
  }catch(error){
    setStatus(error.name==='AbortError'?'Не удалось завершить проверку за 59 секунд. Попробуйте меньше конкурентов.':
      'Не удалось получить сравнение: '+error.message,'error');
  }finally{clearTimeout(timeout);btn.disabled=false;btn.textContent='Сравнить товары ↗';}
});
const csv=(value)=>'"'+String(value??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
$('export-csv').addEventListener('click',()=>{
  if(!current)return;
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
