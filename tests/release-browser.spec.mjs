import {test,expect} from '@playwright/test';

test('Full HD ocean and all GEO prices load',async({page,isMobile})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('.mirvix-ocean-hero')).toBeVisible();
 const video=page.locator('#mirvix-ocean-film');
 const dims=await video.evaluate(async v=>{
  if(v.readyState<1)await new Promise(resolve=>{v.addEventListener('loadedmetadata',resolve,{once:true});setTimeout(resolve,8000);});
  return {width:v.videoWidth,height:v.videoHeight};
 });
 expect(dims).toEqual({width:1920,height:1080});
 await expect(page.locator('.mirvix-code-fragment').first()).toBeAttached();
 await page.goto('/tariffs/');
 const pageText=await page.locator('body').innerText();
 for(const p of ['50 000','89 000','129 000','259 000','45 000','65 000','85 000'])expect(pageText).toContain(p);
 expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/tariffs-'+(isMobile?'mobile':'desktop')+'.png'});
});
test('MIRA asks one-time consent, calls live AI, links to tariffs, keeps contact consent separate',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 const launch=page.locator('[data-mira="launch"]');await launch.click();
 const permission=page.locator('[data-mira="ai-consent-panel"]');await expect(permission).toBeVisible();
 await page.locator('[data-mira="ai-yes"]').click();await expect(permission).toBeHidden();
 await page.locator('[data-mira="input"]').fill('Сколько стоит продвижение в нейросетях по десяти запросам?');
 await page.locator('[data-mira="send"]').click();
 await expect(page.locator('.mira-site-link[href="/tariffs/"]')).toBeVisible({timeout:25000});
 await expect(page.locator('.mira-bubble').last()).not.toContainText('Свободный ИИ-диалог сейчас недоступен',{timeout:25000});
 await page.locator('[data-mira="close"]').click();await launch.click();await expect(permission).toBeHidden();
 await page.locator('[data-mira="delivery-open"]').click();
 await expect(page.locator('[data-mira="delivery-consent"]')).not.toBeChecked();
 expect(errors).toEqual([]);
});
test('homepage submits synthetic lead only after explicit separate consent and gets durable receipt',async({page})=>{
 await page.goto('/');
 const form=page.locator('#mirvix-lead');
 await form.locator('input[name="client_name"]').fill('MIRVIX QA TEST');
 await form.locator('input[name="client_contact"]').fill('mirvix-qa@example.org');
 await form.locator('textarea[name="message"]').fill('Тестовая заявка проверки формы MIRVIX, не требует ответа.');
 await form.locator('input[name="consent"]').check();
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('#lead-status')).toContainText('Заявка №',{timeout:20000});
});
test('public pages offer no WhatsApp contacts',async({page})=>{
 for(const url of ['/','/check/','/tools/','/legal/contacts/']){
  await page.goto(url);
  expect(await page.locator('body').innerText()).not.toMatch(/WhatsApp/i);
  expect(await page.locator('a[href*="wa.me"]').count()).toBe(0);
 }
});

test('Ocean never freezes after brand introduction; labels stay readable',async({page,isMobile})=>{
 await page.goto('/');
 const hero=page.locator('.mirvix-ocean-hero');
 await expect(hero).toBeVisible();
 await expect(hero).toHaveClass(/ocean-intro-done/,{timeout:16000});
 const video=page.locator('#mirvix-ocean-film');
 const current=await video.evaluate(v=>({paused:v.paused,loop:v.loop,time:v.currentTime}));
 expect(current.paused).toBe(false);
 expect(current.loop).toBe(true);
 await page.waitForTimeout(600);
 const moving=await video.evaluate(v=>v.currentTime);
 expect(moving).toBeGreaterThan(current.time);
 const binary=await page.locator('.mirvix-code-fragment').first().evaluate(e=>getComputedStyle(e).animationPlayState);
 expect(binary).toBe('running');
 const label=await page.locator('.hero-copy.ocean-story-copy>p').evaluate(e=>{
   const s=getComputedStyle(e);return {font:parseFloat(s.fontSize),bg:s.backgroundColor,padding:parseFloat(s.paddingLeft)}
 });
 expect(label.font).toBeGreaterThanOrEqual(isMobile?15:18);
 expect(label.padding).toBeGreaterThanOrEqual(10);
 const categories=await page.locator('.mirvix-ocean-hero .capability-row').evaluate(e=>getComputedStyle(e).fontSize);
 expect(parseFloat(categories)).toBeGreaterThanOrEqual(isMobile?12:14);
});
test('MIRA records voice using the server fallback when browser SpeechRecognition is absent',async({page})=>{
 await page.addInitScript(()=>{
   Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
   Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
   const fakeStream={getTracks:()=>[{stop(){}}]};
   if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>fakeStream});
   class FakeRecorder{
      constructor(){this.mimeType='audio/webm';this.state='inactive';}
      static isTypeSupported(){return true;}
      start(){this.state='recording';}
      stop(){this.state='inactive';
       this.ondataavailable?.({data:new Blob([new Uint8Array(900)],{type:'audio/webm'})});
       this.onstop?.();
      }
   }
   Object.defineProperty(window,'MediaRecorder',{value:FakeRecorder,configurable:true});
 });
 await page.route('**/api/mira-transcribe',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'Хочу узнать о тарифах MIRVIX AI'})}));
 await page.goto('/');
 await page.locator('[data-mira="launch"]').click();
 const choice=page.locator('[data-mira="ai-consent-panel"]');
 if(await choice.isVisible())await page.locator('[data-mira="ai-yes"]').click();
 const mic=page.locator('[data-mira="mic"]');
 await mic.click();
 await expect(mic).toHaveAttribute('aria-label','Остановить запись и распознать');
 await mic.click();
 await expect(page.locator('[data-mira="voicecheck"]')).toBeVisible({timeout:8000});
 await expect(page.locator('[data-mira="transcript"]')).toHaveValue('Хочу узнать о тарифах MIRVIX AI');
});
