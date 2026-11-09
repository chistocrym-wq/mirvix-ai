/* MIRVIX GEO question generator: independent of the AI-provider checker.
   The click handler always reports progress/error beside the button, and never
   depends on a blocking browser confirm() or on a previous connection check. */
(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const btn=byId('geo-generate'),note=byId('geo-gen-diagnostic'),textarea=byId('geo-questions');
  if(!btn||!note||!textarea)return;
  let generating=false;
  const originalLabel=btn.textContent.trim();
  const trim=(s,n=120)=>String(s||'').trim().slice(0,n);
  const normalized=s=>trim(s,350).normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  function report(message,kind='info'){
    note.textContent=message;
    note.dataset.state=kind;
    const status=byId('geo-status');
    if(status)status.textContent=message;
  }
  function updateQuestions(lines){
    textarea.value=lines.join('\n');
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function topicFrom(company){
    const source=trim(company.category||company.serviceHeadings?.[0]||'',100)
      .replace(/[?.!,;:]+$/g,'');
    return source&&normalized(source).includes(normalized(company.brand))?'':source;
  }
  function localQuestions(company,count){
    const topic=topicFrom(company);
    if(!topic)return [];
    const loc=company.city?' в '+trim(company.city,90):'';
    const templates=[
      ()=>'Где найти '+topic+loc+'?',
      ()=>'Какие компании предлагают '+topic+loc+'?',
      ()=>'Как выбрать подходящие предложения по теме «'+topic+'»'+loc+'?',
      ()=>'Где можно сравнить варианты '+topic+loc+'?',
      ()=>'Какие цены на '+topic+loc+'?',
      ()=>'Какие компании специализируются на '+topic+loc+'?',
      ()=>'На что обратить внимание при выборе '+topic+loc+'?',
      ()=>'Как проверить качество предложений по теме «'+topic+'»'+loc+'?',
      ()=>'Где найти проверенные отзывы о '+topic+loc+'?',
      ()=>'Какие условия предлагают компании по '+topic+loc+'?',
      ()=>'Что уточнить перед заказом '+topic+loc+'?',
      ()=>'Как сравнить стоимость и сроки для '+topic+loc+'?',
      ()=>'Есть ли проверенные поставщики или исполнители по '+topic+loc+'?',
      ()=>'Какие дополнительные условия нужно уточнять по '+topic+loc+'?',
      ()=>'Как выбрать надёжную компанию по направлению «'+topic+'»'+loc+'?'
    ];
    return templates.slice(0,Math.max(0,Math.min(15,Number(count)||0)))
      .map(make=>make()).filter(q=>q.length>=15&&q.length<=320);
  }
  function currentCompany(){
    return {
      brand:trim(byId('geo-brand')?.value,120),
      domain:trim(byId('geo-url')?.value,220),
      category:trim(byId('geo-category')?.value,180),
      city:trim(byId('geo-city')?.value,120),
      title:'',
      description:'',
      serviceHeadings:[],
      siteExcerpt:''
    };
  }
  async function post(endpoint,payload,timeoutMs=65000){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch('/.netlify/functions/'+endpoint,{
        method:'POST',credentials:'same-origin',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-Mirvix-Cabinet':'1'},
        body:JSON.stringify(payload)
      });
      let data;
      try{data=await response.json();}catch{
        throw new Error('Сервер не вернул JSON. Проверьте публикацию Netlify Functions.');
      }
      if(!response.ok){
        if(response.status===401||response.status===403)
          throw new Error('Сессия сотрудника недействительна. Откройте «Вход для сотрудника MIRVIX AI» и войдите заново.');
        throw new Error(trim(data?.error||('Ошибка API HTTP '+response.status),440));
      }
      return data;
    }catch(err){
      if(err?.name==='AbortError')throw new Error('Сервер не ответил за 65 секунд. Проверьте лимиты и журнал Netlify Functions.');
      throw err;
    }finally{clearTimeout(timeout);}
  }
  async function profileFromSite(company){
    const resp=await fetch('/.netlify/functions/site-audit',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url:company.domain,brand:company.brand})
    });
    let data;
    try{data=await resp.json()}catch{throw new Error('Не удалось получить описание сайта. Заполните поле «Тематика».');}
    if(!resp.ok)throw new Error('Проверка сайта: '+trim(data.error||resp.status,220)+'. Введите тематику вручную.');
    const extras=data.extras||{};
    return {...company,
      title:trim(extras.title,180),description:trim(extras.description,380),
      serviceHeadings:Array.isArray(extras.serviceHeadings)?extras.serviceHeadings.slice(0,18).map(x=>trim(x,120)):[],
      siteExcerpt:trim(extras.contentSnippet,1400)};
  }
  async function createQuestions(){
    if(generating){report('Генерация уже выполняется. Результат появится ниже кнопки.');return;}
    const company=currentCompany();
    const goal=Number(byId('geo-count')?.value||30);
    if(![5,10,15,30,50,70,100].includes(goal)){
      report('Выберите количество вопросов в списке: 5, 10, 15, 30, 50, 70 или 100.','error');return;
    }
    if(company.brand.length<3){
      report('Введите название проверяемой компании (не менее 3 символов).','error');
      byId('geo-brand')?.focus();return;
    }
    if(!company.category&&!company.domain){
      report('Укажите тематику товаров/услуг или адрес сайта, чтобы вопросы были по вашей компании.','error');
      byId('geo-category')?.focus();return;
    }
    generating=true;
    btn.disabled=true;btn.textContent='Создаю вопросы…';
    const other=byId('geo-run');
    if(other)other.disabled=true;
    const previous=textarea.value;
    let prepared=[];
    try{
      report('Кнопка работает. Проверяю доступ к генератору OpenAI / Gemini…');
      let context=company;
      if(!context.category){
        report('Определяю тематику по сайту. Если сайт закрыт для роботов, укажите тематику вручную…');
        context=await profileFromSite(context);
      }
      if(!context.category&&!context.title&&!context.description)
        throw new Error('Не удалось определить тематику сайта. Заполните поле «Тематика, товары или услуги компании».');
      const config=await post('geo-prompts',{action:'config'},20000);
      if(!config.configured)
        throw new Error(config.message||'На сервере нет OPENAI_API_KEY / GEMINI_API_KEY.');
      const providers=[config.available?.openai?'OpenAI':null,config.available?.gemini?'Gemini':null].filter(Boolean).join(' и ');
      report('Генератор доступен ('+providers+'). Создаю '+goal+' вопросов…');
      for(let batch=0;prepared.length<goal&&batch<12;batch++){
        const needed=Math.min(15,goal-prepared.length);
        report('ИИ создаёт вопросы: '+prepared.length+' из '+goal+' (партия '+(batch+1)+')…');
        const result=await post('geo-prompts',{
          action:'generate',...context,count:needed,existing:prepared,batch
        });
        const known=new Set(prepared.map(normalized));
        for(const value of Array.isArray(result.prompts)?result.prompts:[]){
          const q=trim(value,320);
          if(q.length>=15&&!known.has(normalized(q))){
            prepared.push(q);known.add(normalized(q));
          }
          if(prepared.length>=goal)break;
        }
        if(prepared.length){
          updateQuestions(prepared);
          report('Получено '+prepared.length+' из '+goal+' вопросов. '+(prepared.length<goal?'Продолжаю…':'Готово.'));
        }
        if(!Array.isArray(result.prompts)||!result.prompts.length)
          throw new Error('Нейросеть не вернула новых вопросов.');
      }
      if(!prepared.length)throw new Error('ИИ не вернул ни одного корректного вопроса.');
      report('Готово: '+prepared.length+' из '+goal+' вопросов созданы через API. Проверьте их перед запуском платной GEO-проверки.',prepared.length===goal?'success':'warning');
    }catch(error){
      const reason=trim(error?.message||error,420);
      if(!prepared.length){
        if(goal<=15){
          const examples=localQuestions(company,goal);
          if(examples.length){
            prepared=examples;updateQuestions(examples);
            report('API генерации недоступен: '+reason+' Созданы '+examples.length+' шаблонных вопросов БЕЗ ИИ. Их можно отредактировать.','warning');
          }else{
            textarea.value=previous;
            report('Не удалось создать вопросы: '+reason+' Укажите тематику и попробуйте ещё раз.','error');
          }
        }else{
          textarea.value=previous;
          report('Не удалось создать вопросы через ИИ: '+reason+' Попробуйте выбрать 5, 10 или 15 для локального запасного варианта.','error');
        }
      }else{
        report('Получено '+prepared.length+' вопросов. Остальные не созданы: '+reason+' Сохраните готовый список перед повтором.','warning');
      }
    }finally{
      generating=false;btn.disabled=false;btn.textContent=originalLabel;
      if(other)other.disabled=false;
    }
  }
  btn.addEventListener('click',createQuestions);
  // Pure helper deliberately exposed for regression testing and transparent fallback labels.
  if(typeof window!=='undefined')window.MIRVIXPromptGenerator={localQuestions};
})();
