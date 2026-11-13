import {dispatchPending,leadStore} from '../lib/mirvix-lead-outbox.mjs';
export const config={schedule:'*/5 * * * *'};
export default async function scheduled(){
 try{const status=await dispatchPending(leadStore(),{max:35});console.log('MIRVIX lead notification dispatch:',JSON.stringify(status));}
 catch(error){console.error('MIRVIX lead dispatcher: delivery still pending.');}
}