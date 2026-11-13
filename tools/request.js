(()=>{
'use strict';
const form=document.getElementById('tools-request-form');if(!form)return;
const select=document.getElementById('tools-service'),msg=document.getElementById('tools-message'),submit=document.getElementById('tools-submit'),contact=document.getElementById('tools-contact'),channel=document.getElementById('tools-channel'),product=document.getElementById('product-field');
const field=n=>form.elements.namedItem(n);
const setStatus=(text,type='info')=>{msg.textContent=text;msg.dataset.state=type;};
function contactType(){
  if(channel.value==='email'){
    contact.type='email';contact.inputMode='email';contact.autocomplete='email';contact.placeholder='you@company.ru';
  }else if(channel.value==='telegram'){
    contact.type='text';contact.inputMode='text';contact.autocomplete='off';contact.placeholder='@username или https://t.me/username';
  }else{
    contact.type='text';contact.inputMode='text';contact.autocomplete='off';contact.placeholder='@username или https://t.me/username';
  }
}
function chooseService(service,scroll=true){
  if(![...select.options].some(o=>o.value===service))return;
  select.value=service;
  product.hidden=!['product-comparison','price-monitoring'].includes(service);
  if(scroll){document.getElementById('request').scrollIntoView({behavior:'smooth',block:'start'});}
}
document.querySelectorAll('[data-service]').forEach(button=>{
  button.addEventListener('click',()=>chooseService(button.dataset.service));
});
select.addEventListener('change',()=>chooseService(select.value,false));
channel.addEventListener('change',()=>{contactType();contact.value='';});
contactType();chooseService('product-comparison',false);
const requested=new URLSearchParams(location.search).get('service');if(requested)chooseService(requested,false);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!form.reportValidity()||submit.disabled)return;
  const payload={
    company:field('company').value.trim(),site:field('site').value.trim(),
    category:field('category').value.trim(),
    competitor:field('competitor').value.trim(),
    competitorSite:field('competitorSite').value.trim(),
    wantsCompetitor:!!field('competitor').value.trim()||!!field('competitorSite').value.trim(),
    questions:field('questions').value.trim(),
    productLinks:field('productLinks').value.trim(),
    name:field('name').value.trim(),
    channel:channel.value,contact:contact.value.trim(),service:select.value,
    consent:field('consent').checked,
    extra_url:field('extra_url').value
  };
  submit.disabled=true;setStatus('Отправляем заявку специалистам MIRVIX AI…');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
  try{
    const response=await fetch('/api/ai-visibility-request',{
      method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:controller.signal
    });
    let data;
    try{data=await response.json();}catch{throw Error('Сервер не подтвердил отправку.');}
    if(!response.ok||data.submitted!==true)throw Error(data.error||'Заявка не доставлена.');
    setStatus('Заявка принята! Мы проверим данные и направим результат выбранным способом.','success');
    form.reset();contactType();chooseService(select.value,false);
  }catch(error){
    const reason=error.name==='AbortError'?'Время ожидания истекло; подтверждение отправки не получено.':String(error.message||'Ошибка отправки.');
    setStatus(reason+' При повторной ошибке напишите на mirvixai@mail.ru.','error');
  }finally{clearTimeout(timer);submit.disabled=false}
});
})();