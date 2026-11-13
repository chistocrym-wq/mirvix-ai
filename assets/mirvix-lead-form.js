(() => {
 const form=document.getElementById('mirvix-lead');if(!form)return;
 const result=document.getElementById('lead-status');
 const submit=form.querySelector('button[type="submit"]');
 let requestId=null;
 function makeId(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():
   'lead'+Date.now().toString(36)+Math.random().toString(36).slice(2,14);}
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!form.reportValidity()||submit.disabled)return;
  requestId=requestId||makeId();
  const fields=Object.fromEntries(new FormData(form).entries());
  const body={...fields,name:fields.client_name,contact:fields.client_contact,
   task:(fields.message||'Консультация по '+(fields.plan||'ИИ-продвижению')).trim(),
   consent:fields.consent==='on',requestId,type:'general'};
  result.textContent='Сохраняем заявку…';
  submit.disabled=true;
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),14000);
  try{
   const response=await fetch('/api/mirvix-lead',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:timeout.signal});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.saved!==true)throw Error(data.error||'Сохранение не подтверждено.');
   result.textContent=data.notification==='sent'?
    'Заявка №'+data.id+' сохранена и передана специалистам MIRVIX AI.':
    'Заявка №'+data.id+' сохранена. Уведомление сотрудникам будет отправлено повторно.';
   result.dataset.state='success';form.reset();requestId=null;
  }catch(error){
   result.dataset.state='error';
   result.textContent='Не удалось подтвердить сохранение заявки. '+(error.name==='AbortError'?'Сервер не ответил вовремя. Повторите отправку.':error.message);
  }finally{clearTimeout(timer);submit.disabled=false;}
 });
})();