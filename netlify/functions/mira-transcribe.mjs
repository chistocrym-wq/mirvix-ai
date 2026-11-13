// Optional browser audio transcription for MIRA. Audio and contacts are never persisted.
// Consent is explicit for every recording, and microphone data goes only to OpenAI when enabled.
const LIMIT=3_500_000;
const answer=(x,status=200)=>Response.json(x,{status,headers:{
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
function sameOrigin(request){
  const raw=request.headers.get('origin');
  if(!raw)return true;
  try{return new URL(raw).origin===new URL(request.url).origin;}catch{return false;}
}
export default async function handler(request){
  if(request.method!=='POST')return answer({error:'Используйте POST.'},405);
  if(!sameOrigin(request))return answer({error:'Недопустимый источник запроса.'},403);
  const size=Number(request.headers.get('content-length')||0);
  if(size>LIMIT+20000)return answer({error:'Запись слишком длинная. Попробуйте до 15 секунд.'},413);
  const key=process.env.MIRA_TRANSCRIBE_API_KEY||process.env.OPENAI_API_KEY;
  if(!key)return answer({error:'Распознавание на сервере ещё не подключено. Напишите сообщение текстом.'},503);
  let data;
  try{data=await request.formData();}catch{return answer({error:'Не удалось прочитать запись.'},400);}
  if(data.get('consent')!=='true')return answer({error:'Для распознавания записи требуется согласие.'},400);
  const audio=data.get('audio');
  if(!(audio instanceof Blob)||audio.size<400||audio.size>LIMIT)
    return answer({error:'Пустая или слишком большая аудиозапись.'},422);
  const formats=new Set(['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav']);
  const mime=audio.type.split(';')[0].trim().toLowerCase();
  if(!formats.has(mime))return answer({error:'Браузер использует неподдерживаемый формат записи.'},415);
  const extension=mime==='audio/mp4'?'mp4':mime==='audio/ogg'?'ogg':mime==='audio/mpeg'?'mp3':mime.includes('wav')?'wav':'webm';
  const outgoing=new FormData();
  outgoing.append('file',new File([audio],'mira-voice.'+extension,{type:mime}));
  outgoing.append('model',process.env.MIRA_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe');
  outgoing.append('language','ru');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),24000);
  try{
    const resp=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{authorization:'Bearer '+key},body:outgoing,signal:controller.signal,redirect:'error'
    });
    if(!resp.ok)return answer({error:resp.status===429?'Превышен лимит распознавания. Попробуйте позже.':
      'Сервис распознавания сейчас недоступен. Можно написать сообщение текстом.'},503);
    const result=await resp.json().catch(()=>null);
    const text=typeof result?.text==='string'?result.text.trim().slice(0,1400):'';
    if(!text)return answer({error:'Речь не удалось распознать. Можно надиктовать ещё раз.'},422);
    return answer({text});
  }catch{return answer({error:'Не удалось обработать голос. Попробуйте ещё раз или напишите текстом.'},503);}
  finally{clearTimeout(timer);}
}
export const config={path:'/api/mira-transcribe',
  rateLimit:{windowLimit:6,windowSize:60,aggregateBy:['ip','domain']}};
