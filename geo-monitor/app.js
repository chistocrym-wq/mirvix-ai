(()=>{"use strict";
const $=id=>document.getElementById(id),text=(tag,value)=>{const el=document.createElement(tag);el.textContent=String(value??"");return el};
const base=()=>({brand:"",domain:"",industry:"",city:"",aliases:[],rivals:[],prompts:[],checks:[],tasks:[],audits:[],history:[],period:"Первый замер"});
const standard=["Проверить robots.txt и доступ роботов","Проверить sitemap.xml, noindex, canonical, HTTP","Проверить индексацию в панелях вебмастеров","Опубликовать полный паспорт компании","Создать полезные страницы товаров и услуг","Добавить корректную Schema.org разметку","Получить реальные отзывы и кейсы","Проверить и обновить тематические каталоги","Опубликовать экспертные материалы в релевантных источниках","Подключить аналитику переходов и обращений","Провести новый замер по той же матрице"];
let token="",connected=false,providers={},project=base();
const arr=x=>Array.isArray(x)?x:[],str=(x,max=2000)=>String(x??"").trim().slice(0,max),today=()=>new Date().toISOString();
function status(msg){$("server").textContent=msg}
function update(){["brand","domain","industry","city"].forEach(k=>project[k]=str($(k).value,300));["aliases","rivals","prompts"].forEach(k=>project[k]=[...new Set($(k).value.split(/\r?\n/).map(x=>str(x,300)).filter(Boolean))])}
function fill(){["brand","domain","industry","city"].forEach(k=>$(k).value=project[k]||"");["aliases","rivals","prompts"].forEach(k=>$(k).value=arr(project[k]).join("\n"))}
async function api(endpoint,action,body){
 if(!token)throw Error("Сначала введите токен администратора");
 const response=await fetch("/.netlify/functions/"+endpoint+"?action="+encodeURIComponent(action),{method:body===undefined?"GET":"POST",headers:{"authorization":"Bearer "+token,...(body===undefined?{}:{"content-type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await response.json()}catch{throw Error("Сервер не вернул JSON: HTTP "+response.status)}
 if(!response.ok)throw Error(data.error||"Ошибка HTTP "+response.status);return data
}
function error(e){status("Ошибка: "+e.message);alert(e.message)}
function show(n){
 update();document.querySelectorAll("[data-view]").forEach(e=>e.classList.toggle("hide",Number(e.dataset.view)!==n));document.querySelectorAll("[data-stage]").forEach(e=>e.classList.toggle("active",Number(e.dataset.stage)===n));
 if(n===2)renderChecks();if(n===3)renderCompetitors();if(n===4)renderTasks();if(n===5)renderReport();window.scrollTo(0,0)
}
document.querySelectorAll("[data-stage],[data-next]").forEach(el=>el.addEventListener("click",()=>{
 const step=Number(el.dataset.stage??el.dataset.next);update();if(step>0&&(!project.brand||!project.industry))return alert("Сначала укажите бренд и категорию");if(step>1&&!project.prompts.length)return alert("Сначала добавьте запросы");show(step)
}));
$("connect").addEventListener("click",async()=>{
 token=$("token").value.trim();try{const service=await api("mirvix-geo","status");const saved=await api("mirvix-geo","load");const tools=await api("mirvix-tools","status");providers=tools.providers||{};project={...base(),...saved.project};connected=true;fill();status("Подключено. "+(service.preview?"Preview — отдельное хранилище":"Production")+". API: "+Object.keys(providers).filter(x=>providers[x]).join(", "));show(0)}
 catch(e){connected=false;error(e)}
});
$("save").addEventListener("click",async()=>{update();try{await api("mirvix-geo","save",{project});status("Сохранено: "+new Date().toLocaleString("ru-RU"))}catch(e){error(e)}});
$("generate").addEventListener("click",()=>{
 update();const k=project.industry||"товары и услуги",g=project.city||"моём городе";
 const samples=["Где купить "+k+" в "+g+"?","Какие компании предлагают "+k+" в "+g+"?","Лучшие поставщики "+k+" в "+g,"Где заказать "+k+" с доставкой в "+g+"?","Кто продаёт "+k+" недорого в "+g+"?","Сравнение предложений "+k+" в "+g,"Кого рекомендуют для "+k+" в "+g+"?","Популярные магазины "+k+" в "+g,"Где заказать "+k+" для бизнеса в "+g+"?","Какие фирмы специализируются на "+k+" в "+g+"?","Надёжные поставщики "+k+" в "+g,"У каких компаний есть "+k+" в наличии в "+g+"?","Как выбрать компанию по "+k+" в "+g+"?","Где быстро получить "+k+" в "+g+"?","Какая компания доставляет "+k+" завтра в "+g+"?","У кого заказать оптом "+k+" в "+g+"?","Какие альтернативы есть для "+k+" в "+g+"?","Где найти отзывы о поставщиках "+k+" в "+g+"?","Кто работает с юридическими лицами по "+k+" в "+g+"?","Компании с большим ассортиментом "+k+" в "+g];
 project.prompts=[...new Set([...project.prompts,...samples])];$("prompts").value=project.prompts.join("\n");status("20 шаблонов добавлены. Отредактируйте их перед проверками.")
});
function refreshPrompts(){update();const select=$("prompt"),prior=select.value;select.replaceChildren();project.prompts.forEach(q=>{const item=text("option",q);item.value=q;select.append(item)});if(project.prompts.includes(prior))select.value=prior}
function addCheck(c){project.checks.push(c);renderChecks();status("Добавлено в журнал. Для записи в хранилище нажмите «Сохранить проект».")}
function matches(answer,links){
 const names=[project.brand,...arr(project.aliases)].map(x=>str(x).toLocaleLowerCase("ru-RU")).filter(x=>x.length>=3),hay=answer.toLocaleLowerCase("ru-RU");
 let linked=false;try{const domain=new URL(project.domain).hostname.replace(/^www\./,"");linked=links.some(link=>{try{return new URL(link).hostname.replace(/^www\./,"")===domain}catch{return false}})}catch{}
 return linked?"linked":names.some(n=>hay.includes(n))?"mentioned":"absent";
}
$("probe").addEventListener("click",async()=>{
 refreshPrompts();const provider=$("provider").value,question=$("prompt").value;
 if(!question)return alert("Нет запросов");if(!["OpenAI API","Gemini API","Perplexity API"].includes(provider))return alert("Выбран ручной режим");
 if(!providers[provider])return alert("Ключ провайдера не подключён");
 if(!confirm("Выполнить один платный запрос к "+provider+"?"))return;
 try{status("Выполняется запрос к "+provider+"...");const data=await api("mirvix-tools","probe",{provider,question});const x=data.result;
 const outcome=matches(x.answer,arr(x.sources));const rivals=project.rivals.filter(name=>x.answer.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU"))).join(", ");
 addCheck({provider,question,outcome,answer:x.answer,sources:arr(x.sources),rivals,method:"api",model:x.model,at:x.at});
 $("answer").value=x.answer;$("sources").value=arr(x.sources).join("\n");$("namedRivals").value=rivals;$("verdict").value=outcome;
 status("Ответ получен. Статус определён предварительно, проверьте его вручную.")
 }catch(e){error(e)}
});
$("manual").addEventListener("click",()=>{
 refreshPrompts();const question=$("prompt").value,answer=str($("answer").value,6000),sources=$("sources").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(!question)return alert("Сначала создайте запрос");if(!answer&&!sources.length)return alert("Введите доказательство или ссылку");
 if(sources.some(x=>!/^https?:\/\//i.test(x)))return alert("Ссылки должны начинаться с http(s)://");
 addCheck({provider:$("provider").value,question,outcome:$("verdict").value,answer,sources,rivals:str($("namedRivals").value,500),method:"manual",at:today(),model:""})
});
function renderChecks(){
 refreshPrompts();const root=$("records");root.replaceChildren();project.checks.slice().reverse().forEach((c,reverse)=>{
 const i=project.checks.length-1-reverse,tr=text("tr","");[new Date(c.at).toLocaleString("ru-RU"),c.provider,c.question,c.outcome+" / "+c.method].forEach(x=>tr.append(text("td",x)));
 const proof=text("td",""),details=text("details","");details.append(text("summary","Ответ и ссылки"),text("p",c.answer||"Текст не сохранён"));
 arr(c.sources).forEach(url=>{if(/^https?:\/\//.test(url)){const a=text("a",url);a.href=url;a.target="_blank";a.rel="noopener noreferrer";details.append(a,text("br",""))}});proof.append(details);tr.append(proof);
 const td=text("td",""),del=text("button","Удалить");del.className="danger";del.addEventListener("click",()=>{if(confirm("Удалить ответ?")){project.checks.splice(i,1);renderChecks()}});td.append(del);tr.append(td);root.append(tr)
 });if(!root.children.length){const tr=text("tr",""),td=text("td","Проверок пока нет");td.colSpan=6;tr.append(td);root.append(tr)}
}
function current(){
 const uniq=new Map();arr(project.checks).forEach(c=>uniq.set(c.provider+"|"+c.question,c));return [...uniq.values()].filter(x=>x.outcome!=="error")
}
function stats(){const data=current(),hits=data.filter(x=>["mentioned","recommended","linked"].includes(x.outcome));return {total:data.length,hits:hits.length,share:data.length?Math.round(100*hits.length/data.length):null}}
function renderCompetitors(){
 const s=stats(),metrics=$("metrics");metrics.replaceChildren();[[s.total,"Проверенных сочетаний"],[s.hits,"Ответов с брендом"],[s.share===null?"—":s.share+"%","Доля видимости"]].forEach(([n,k])=>{const card=text("div","");card.className="metric";card.append(text("strong",n),text("span",k));metrics.append(card)});
 const chart=$("competitorChart"),gaps=$("gaps");chart.replaceChildren();gaps.replaceChildren();const a=current(),count={};
 a.forEach(c=>c.rivals.split(",").map(x=>x.trim()).filter(Boolean).forEach(name=>count[name]=(count[name]||0)+1));
 Object.entries(count).sort((x,y)=>y[1]-x[1]).forEach(([name,n])=>{const row=text("div","");row.append(text("p",name+" — "+n+" упоминаний"));const bar=text("div","");bar.className="bar";const fill=text("i","");fill.style.width=Math.round(n/Math.max(1,a.length)*100)+"%";bar.append(fill);row.append(bar);chart.append(row)});
 if(!chart.children.length)chart.append(text("p","Конкуренты пока не зафиксированы"));
 const empty=a.filter(x=>x.outcome==="absent"&&x.rivals.trim());gaps.append(text("p",empty.length?"Обнаружено сочетаний: "+empty.length:"Пока нет данных"));empty.forEach(x=>gaps.append(text("p",x.provider+" · "+x.question+" → "+x.rivals)));
}
function renderTasks(){
 if(!project.tasks.length)project.tasks=standard.map(name=>({name,done:false}));const root=$("tasks");root.replaceChildren();
 project.tasks.forEach((t,i)=>{const row=text("div","");row.className="task";const check=document.createElement("input");check.type="checkbox";check.checked=!!t.done;check.id="t"+i;check.addEventListener("change",()=>t.done=check.checked);const label=text("label",t.name);label.htmlFor=check.id;row.append(check,label);root.append(row)})
}
$("extraTask").addEventListener("click",()=>{const s=prompt("Новая задача");if(s?.trim()){project.tasks.push({name:str(s,200),done:false});renderTasks()}});
$("audit").addEventListener("click",async()=>{update();if(!project.domain)return alert("Введите адрес сайта");
 try{status("Анализируем публичные файлы сайта...");const a=(await api("mirvix-tools","audit",{url:project.domain})).audit;project.audits.push(a);renderAudit(a);status("Аудит получен. Сохраните проект.")}catch(e){error(e)}
});
function renderAudit(a){const box=$("auditResults");box.replaceChildren();if(!a)return;box.append(text("h3","Технический аудит · "+new Date(a.checkedAt).toLocaleString("ru-RU")));arr(a.checks).forEach(c=>{const item=text("p",c.name+" — "+(c.status==="ok"?"Подтверждено":c.status==="issue"?"Замечание":"Не проверено")+" · "+c.detail);item.className=c.status;box.append(item)})}
function renderReport(){
 update();const box=$("report"),s=stats();box.replaceChildren();box.append(text("h3",project.brand+" — "+project.period),text("p","Сайт: "+(project.domain||"не указан")+" · География: "+project.city),text("p","Матрица: "+project.prompts.length+" вопросов · Проверено: "+s.total+" · Упоминаний: "+s.hits+" · Частота: "+(s.share===null?"нет данных":s.share+"%")),text("p","Задач выполнено: "+project.tasks.filter(x=>x.done).length+"/"+project.tasks.length));
 box.append(text("h3","Предыдущие периоды"));if(!project.history.length)box.append(text("p","Ещё нет"));project.history.forEach(h=>box.append(text("p",h.period+": "+h.hits+"/"+h.total+" ("+(h.share===null?"—":h.share+"%")+")")));
 box.append(text("h3","Методика"));box.append(text("p","Повторные ответы на одну пару провайдер / запрос в рамках периода учитываются последним ответом. API и интерфейсы приложений могут отличаться. Нет гарантии нейровыдачи или продаж."))
}
function saveFile(content,name,mime){const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=text("a","");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$("export").addEventListener("click",()=>{update();saveFile(JSON.stringify({format:"mirvix-geo-v1",exportedAt:today(),project},null,2),"mirvix-geo.json","application/json")});
$("import").addEventListener("click",()=>$("upload").click());$("upload").addEventListener("change",async()=>{const f=$("upload").files?.[0];if(!f)return;if(f.size>700000)return alert("Файл слишком большой");try{const d=JSON.parse(await f.text());if(!d.project||!Array.isArray(d.project.checks))throw Error("Неверный формат");project={...base(),...d.project};fill();show(0);status("Импортировано. Сохраните проект на сервере.")}catch(e){error(e)}});
$("csv").addEventListener("click",()=>{const cols=["at","provider","question","outcome","method","model","rivals","answer","sources"];const lines=[cols.join(";"),...project.checks.map(c=>cols.map(key=>'"'+String(key==="sources"?arr(c[key]).join(" | "):c[key]||"").replace(/"/g,'""')+'"').join(";"))];saveFile("\uFEFF"+lines.join("\r\n"),"mirvix-geo-answers.csv","text/csv;charset=utf-8")});
$("pdf").addEventListener("click",()=>window.print());
$("repeat").addEventListener("click",()=>{update();if(!confirm("Перед началом нового периода экспортируйте текущие ответы и сохраните проект. Продолжить?"))return;project.history.push({...stats(),period:project.period,at:today()});project.checks=[];project.period="Замер "+new Date().toLocaleDateString("ru-RU");show(2);status("Новый период. Сохраните проект.")});
fill();show(0);
})();