const crypto=require("node:crypto");
const {getStore,getDeployStore}=require("@netlify/blobs");
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const respond=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
function allow(event){
 const secret=process.env.MIRVIX_CABINET_TOKEN;
 if(!secret||secret.length<20)return false;
 const token=String(event.headers.authorization||event.headers.Authorization||"").replace(/^Bearer\s+/i,"");
 const a=Buffer.from(token),b=Buffer.from(secret);
 return a.length===b.length&&crypto.timingSafeEqual(a,b)
}
const preview=(process.env.CONTEXT||"production")!=="production";
function store(){return preview?getDeployStore("mirvix-geo-preview"):getStore("mirvix-geo-production")}
const clean=(x,max=1000)=>String(x??"").trim().slice(0,max);
const items=(x,n)=>Array.isArray(x)?x.slice(0,n):[];
function normalize(data){
 if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Некорректный проект");
 const project={
  brand:clean(data.brand,120),domain:clean(data.domain,300),industry:clean(data.industry,200),city:clean(data.city,150),
  aliases:items(data.aliases,20).map(x=>clean(x,120)),
  rivals:items(data.rivals,30).map(x=>clean(x,120)),
  prompts:items(data.prompts,200).map(x=>clean(x,300)),
  period:clean(data.period,100),
  checks:items(data.checks,1500).map(x=>({
    provider:clean(x.provider,50),question:clean(x.question,300),outcome:clean(x.outcome,50),
    answer:clean(x.answer,6000),sources:items(x.sources,20).map(u=>clean(u,500)),
    rivals:clean(x.rivals,500),method:clean(x.method,40),model:clean(x.model,100),at:clean(x.at,80)
  })),
  tasks:items(data.tasks,100).map(x=>({name:clean(x.name,250),done:!!x.done})),
  audits:items(data.audits,15).map(x=>({checkedAt:clean(x.checkedAt,80),requested:clean(x.requested,300),checks:items(x.checks,40).map(y=>({name:clean(y.name,100),status:clean(y.status,30),detail:clean(y.detail,400)}))})),
  history:items(data.history,100).map(x=>({period:clean(x.period,100),total:Number(x.total)||0,hits:Number(x.hits)||0,share:x.share===null?null:Number(x.share)||0,at:clean(x.at,80)})),
  updatedAt:new Date().toISOString()
 };
 if(!project.brand||!project.industry)throw Error("Укажите бренд и категорию");
 if(JSON.stringify(project).length>650000)throw Error("Превышен лимит размера проекта");
 return project
}
const empty=()=>({brand:"",domain:"",industry:"",city:"",aliases:[],rivals:[],prompts:[],checks:[],tasks:[],audits:[],history:[],period:"Первый замер"});
exports.handler=async event=>{
 try{
  if(!allow(event))return respond(process.env.MIRVIX_CABINET_TOKEN?401:503,{error:"Нет доступа: задайте корректный MIRVIX_CABINET_TOKEN в Netlify"});
  const action=event.queryStringParameters?.action||"status";
  if(event.httpMethod==="GET"&&action==="status")return respond(200,{ok:true,preview,storage:preview?"deploy-specific":"production"});
  if(event.httpMethod==="GET"&&action==="load")return respond(200,{project:await store().get("geo-admin-project",{type:"json"})||empty()});
  if(event.httpMethod==="POST"&&action==="save"){
   const body=JSON.parse(event.body||"{}"),project=normalize(body.project);
   await store().setJSON("geo-admin-project",project);
   return respond(200,{ok:true,updatedAt:project.updatedAt})
  }
  return respond(404,{error:"Неизвестная операция"});
 }catch(e){console.error("GEO backend",e.message);return respond(400,{error:clean(e.message,250)})}
};