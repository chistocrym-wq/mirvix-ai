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
