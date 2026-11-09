/* MIRVIX GEO report metrics. Original calculations from observed API results.
   No fabricated percentages or unverifiable referral traffic. */
(function(root){
  'use strict';
  const pct=(numerator,denominator)=>denominator>0?Math.round(numerator*100/denominator):null;
  const searchEligible=r=>r&&r.provider!=='gigachat'&&r.mode!=='model-only';
  const success=r=>r&&!r.error&&typeof r.answer==='string'&&r.answer.trim().length>0;
  const normalized=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  function isEarly(r,brand){
    if(!success(r)||!r.brandMention||!brand)return null;
    const text=normalized(r.answer),name=normalized(brand);
    if(name.length<3)return null;
    const index=(' '+text+' ').indexOf(' '+name+' ');
    if(index<0)return null; // e.g. alias used, cannot position accurately
    return index<=Math.floor(text.length/3);
  }
  function perProvider(results,ids){
    return ids.map(id=>{
      const attempts=results.filter(r=>r.provider===id);
      const answered=attempts.filter(success);
      const mentions=answered.filter(r=>r.brandMention).length;
      const sources=answered.filter(r=>r.sourceMention).length;
      return {id,attempted:attempts.length,answered:answered.length,errors:attempts.length-answered.length,
        mentions,sources,mentionRate:pct(mentions,answered.length),sourceRate:pct(sources,answered.length),
        modelOnly:id==='gigachat'||answered.some(r=>r.mode==='model-only')};
    });
  }
  function calculate(results,brand,competitors,providerIds){
    const list=Array.isArray(results)?results:[];
    const valid=list.filter(success);
    const web=list.filter(searchEligible);
    const webAnswers=web.filter(success);
    const mentioned=webAnswers.filter(r=>r.brandMention);
    const ownLinks=webAnswers.filter(r=>r.sourceMention);
    const searched=webAnswers.filter(r=>r.searchEvidence);
    const exact=mentioned.map(r=>isEarly(r,brand)).filter(x=>x!==null);
    const knownCompetitors=(Array.isArray(competitors)?competitors:[])
      .map(normalized).filter((x,i,a)=>x.length>=3&&x!==normalized(brand)&&a.indexOf(x)===i).slice(0,10);
    const competitorMentions=knownCompetitors.length?
      webAnswers.reduce((n,r)=>n+new Set((r.competitorsMentioned||[]).map(normalized)
        .filter(name=>knownCompetitors.includes(name))).size,0):0;
    const sov=knownCompetitors.length?pct(mentioned.length,mentioned.length+competitorMentions):null;
    const rates=perProvider(list,Array.isArray(providerIds)?providerIds:[]);
    return {attempted:list.length,answered:valid.length,modelOnlyAnswers:valid.filter(r=>r.mode==='model-only'||r.provider==='gigachat').length,
      webAnswers:webAnswers.length,webErrors:web.length-webAnswers.length,webMentions:mentioned.length,
      webLinks:ownLinks.length,mentionRate:pct(mentioned.length,webAnswers.length),
      linkRate:pct(ownLinks.length,webAnswers.length),searchedRate:pct(searched.length,webAnswers.length),
      completionRate:pct(webAnswers.length,web.length),
      earlyRate:pct(exact.filter(Boolean).length,exact.length),earlyKnown:exact.length,
      voiceShare:sov,competitorMentions,hasCompetitors:knownCompetitors.length>0,
      providers:rates};
  }
  function heatmap(results,questions,providerIds) {
    const mapped=new Map();
    for(const r of Array.isArray(results)?results:[]){
      if(typeof r?.prompt!=='string'||typeof r.provider!=='string')continue;
      mapped.set(r.prompt+'\u0000'+r.provider,r);
    }
    const rows=[];
    for(const prompt of (Array.isArray(questions)?questions:[]).slice(0,100)){
      const cells=[];
      for(const id of (Array.isArray(providerIds)?providerIds:[]).slice(0,8)){
        const r=mapped.get(prompt+'\u0000'+id);
        const status=!r?'pending':r.error||!success(r)?'error':
          r.brandMention&&r.sourceMention?'link-and-brand':
          r.brandMention?'brand':r.sourceMention?'source-only':'absent';
        cells.push({id,status,error:r?.error||null,modelOnly:id==='gigachat'});
      }
      rows.push({prompt,cells});
    }
    return rows;
  }
  root.MIRVIXReportMetrics=Object.freeze({pct,success,isEarly,calculate,perProvider,heatmap});
})(globalThis);