// Optional microphone fallback for browsers without Web Speech recognition.
// Short recordings are transcribed on the server, never stored or sent to Telegram.
const respond=(body,status=200)=>Response.json(body,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
}});
const LIMIT=3_000_000;
function sameOrigin(request) {
 const origin=request.headers.get('origin');
 if(!origin)return true;
 try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}
}
export default async function handler(request){
 if(request.method!=='POST')return respond({error:'Допускается только POST.'},405);
 if(!sameOrigin(request))return respond({error:'Неверный источник запроса.'},403);
 const size=Number(request.headers.get('content-length')||0);
 if(size>LIMIT+30000)return respond({error:'Запись слишком большая. Говорите не более 15 секунд.'},413);
 const key=process.env.MIRA_TRANSCRIBE_API_KEY||process.env.OPENAI_API_KEY;
 if(!key)return respond({error:'Серверное распознавание пока не подключено. Напишите сообщение текстом.'},503);
 let data;
 try {data=await request.formData();}catch{return respond({error:'Не удалось прочитать аудиозапись.'},400);}
 if(data.get('consent')!=='true')return respond({error:'Для распознавания голоса необходимо согласие на обработку ИИ.'},400);
 const file=data.get('audio');
 if(!(file instanceof Blob)||file.size<400||file.size>LIMIT)return respond({error:'Запись пустая или слишком длинная.'},422);
 const mime=String(file.type||'').split(';')[0].toLowerCase();
 const extensions={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav'};
 if(!extensions[mime])return respond({error:'Неподдерживаемый формат записи.'},415);
 const form=new FormData();
 form.append('file',new File([file],'mira-voice.'+extensions[mime],{type:mime}));
 form.append('model',process.env.MIRA_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe');
 form.append('language','ru');
 const base=process.env.MIRA_TRANSCRIBE_BASE_URL||'https://api.openai.com/v1';
 const url=base.replace(/\/+$/,'')+'/audio/transcriptions';
 // Only explicitly trusted official endpoint by default; no untrusted user URL.
 const ctl=new AbortController();
 const timer=setTimeout(()=>ctl.abort(),22000);
 try{
  const resp=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:ctl.signal,redirect:'error'});
  if(!resp.ok)return respond({error:resp.status===429?'Сервис распознавания временно перегружен. Повторите позже.':'Распознавание временно недоступно. Можно написать сообщение.'},503);
  const result=await resp.json().catch(()=>null);
  const text=typeof result?.text==='string'?result.text.trim().slice(0,1600):'';
  if(!text)return respond({error:'Не удалось разобрать речь. Попробуйте снова.'},422);
  return respond({text});
 }catch{
  return respond({error:'Не удалось распознать запись. Повторите или напишите текстом.'},503);
 }finally {clearTimeout(timer);}
}
export const config={path:'/api/mira-transcribe',rateLimit:{windowLimit:5,windowSize:60,aggregateBy:['ip','domain']}};
