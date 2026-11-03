import {createSession,sessionRole,sessionCookie,expiredCookie,passwordEqual,rolePassword,requestIsSameOrigin} from '../lib/cabinet-session.mjs';
const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const out=(statusCode,body,cookie)=>({statusCode,headers:{...h,...(cookie?{'set-cookie':cookie}:{})},body:JSON.stringify(body)});
export async function handler(event){
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 if((event.body||'').length>2400||!requestIsSameOrigin(event))return out(403,{error:'Запрос заблокирован.'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return out(400,{error:'Неверный запрос.'})}
 if(body.action==='status'){const role=sessionRole(event.headers);return out(200,{role,configured:!!(process.env.MIRVIX_CABINET_SESSION_SECRET?.length>=32&&rolePassword('staff').length>=12),...(role==='staff'?{partnerConfigured:rolePassword('partner').length>=12,aiProviders:['OPENAI_API_KEY','GEMINI_API_KEY','PERPLEXITY_API_KEY'].filter(k=>!!process.env[k]).map(k=>k.replace('_API_KEY',''))}:{})});}
 if(body.action==='logout')return out(200,{role:null},expiredCookie());
 if(body.action!=='login')return out(400,{error:'Неизвестная команда'});
 const role=body.role==='partner'?'partner':'staff';
 if(!rolePassword(role)||!passwordEqual(body.password,rolePassword(role)))return out(401,{error:'Неверный пароль или роль не настроена.'});
 try{return out(200,{role},sessionCookie(createSession(role)))}
 catch{return out(503,{error:'Задайте MIRVIX_CABINET_SESSION_SECRET в Netlify (32+ символа).'})}
}