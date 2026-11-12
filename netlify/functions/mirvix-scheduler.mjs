// Netlify Scheduled Function: runs only on production deployments.
// In deploy previews use the authenticated /platform/ -> "Process one" button.
// The worker cannot execute paid calls unless the global paid switch and
// an atomic positive per-organization/provider budget have both been enabled.
import {configured} from '../lib/mirvix-platform.mjs';
import {processOne} from '../lib/mirvix-jobs.mjs';
export const config={schedule:'*/5 * * * *'};
export default async function scheduled(){
 if(!configured())return;
 try{await processOne();}
 catch(error){console.error('MIRVIX scheduled worker:',String(error?.message||'error').slice(0,200));}
}
