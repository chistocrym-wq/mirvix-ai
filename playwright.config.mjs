import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'release-browser.spec.mjs',
 timeout:35000,expect:{timeout:10000},retries:1,workers:1,
 reporter:'line',
 use:{baseURL:process.env.MIRVIX_TEST_BASE_URL||'https://deploy-preview-39--resonant-cupcake-231bab.netlify.app',
  trace:'on-first-retry',screenshot:'only-on-failure'},
 projects:[
  {name:'desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1366,height:768}}},
  {name:'mobile-chromium',use:{...devices['Pixel 7'],browserName:'chromium'}}
 ]
});