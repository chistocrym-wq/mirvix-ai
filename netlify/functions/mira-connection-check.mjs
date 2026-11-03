// Temporary, non-secret Telegram diagnostic for the Deploy Preview only.
// It checks Bot API reachability without sending a message or revealing IDs or tokens.
const out = (obj, code=200) => Response.json(obj,{status:code,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default async function handler(request){
  if(request.method!=='GET')return out({error:'Method not allowed'},405);
  if(process.env.CONTEXT!=='deploy-preview')return out({error:'Unavailable'},404);
  const token=process.env.MIRA_TELEGRAM_BOT_TOKEN;
  const chat=process.env.MIRA_TELEGRAM_CHAT_ID;
  if(!token||!chat) return out({botConfigured:Boolean(token),chatConfigured:Boolean(chat)});
  if(!/^-?\d{5,22}$/.test(chat))return out({botConfigured:true,chatConfigured:true,chatIdFormatValid:false});
  try{
    const t=AbortSignal.timeout(9000);
    const me=await fetch('https://api.telegram.org/bot'+token+'/getMe',{signal:t});
    const valid=await me.json().catch(()=>({}));
    if(!me.ok||valid.ok!==true) return out({botAuthorized:false,chatVerified:false,problem:'invalid_bot_token_or_api_access'});
    const url='https://api.telegram.org/bot'+token+'/getChat?chat_id='+encodeURIComponent(chat);
    const result=await fetch(url,{signal:t});
    const data=await result.json().catch(()=>({}));
    return out({botAuthorized:true,chatIdFormatValid:true,chatVerified:result.ok&&data.ok===true,problem:result.ok&&data.ok===true?null:'chat_not_accessible_to_bot'});
  }catch{return out({botAuthorized:null,chatVerified:null,problem:'telegram_api_unreachable'});}
}
export const config={path:'/api/mira-connection-check',rateLimit:{windowLimit:2,windowSize:60,aggregateBy:['ip','domain']}};
