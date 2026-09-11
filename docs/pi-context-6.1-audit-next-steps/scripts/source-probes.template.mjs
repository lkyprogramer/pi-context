import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createPlugin,applyContext,setProfile} from './compiled/src/plugin.js';
import {parseConfig,configHashOf} from './compiled/src/config.js';
import {buildScope} from './compiled/src/history/scope.js';
import {refForField,encodeRef} from './compiled/src/history/refs.js';
import {HistoryIndex} from './compiled/src/history/index.js';
import {searchHistory} from './compiled/src/history/search.js';
import {readHistory,formatHistoryResult} from './compiled/src/history/read.js';
import {exposedEntryIds} from './compiled/src/projection/exposed.js';
import {collectBatches} from './compiled/src/projection/batches.js';
import {summarize,decide,cacheAfterFold,loadEpisodes} from __REPORT_URL__;
const out=[], root=mkdtempSync(join(tmpdir(),'pctx-audit-'));
const cfg=parseConfig({schemaVersion:6,profile:'balanced',storage:{mode:'memory-only'},fold:{minRemovedTokens:100,protectRecentBatches:1,minFoldableBytes:1024}});
const user=(id,p,text='question')=>({id,parentId:p,type:'message',message:{role:'user',content:[{type:'text',text}]}});
const call=(id,p,c)=>({id,parentId:p,type:'message',message:{role:'assistant',content:[{type:'toolCall',id:c,name:'read',arguments:{path:'f'}}],stopReason:'toolUse',usage:{input:1,totalTokens:2}}});
const result=(id,p,c,t)=>({id,parentId:p,type:'message',message:{role:'toolResult',toolCallId:c,toolName:'read',isError:false,content:[{type:'text',text:t}]}});
const done=(id,p)=>({id,parentId:p,type:'message',message:{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop',usage:{input:2,totalTokens:3}}});
const scope=(entries,leaf,session='s')=>buildScope({cwd:root,sessionId:session,leafId:leaf,getEntry:id=>entries.find(e=>e.id===id)});
async function probe(id,f){try{const observed=await f();out.push({id,executed:true,...observed});}catch(e){out.push({id,executed:false,error:String(e.stack)})}}
await probe('P01-archived-plan',()=>{
 const a=[user('u',null),call('c','u','tc'),result('r','c','tc','x'.repeat(80000)),done('d','r'),user('tail','d')];
 let parent='tail';
 for(let i=2;i<=5;i++){a.push(call('c'+i,parent,'new'+i),result('r'+i,'c'+i,'new'+i,'t'.repeat(20000)),done('d'+i,'r'+i));parent='d'+i;}
 a.push({id:'compact',parentId:parent,type:'compaction',summary:'old summarized',firstKeptEntryId:'tail'},user('now','compact'));
 const msgs=[{role:'compactionSummary',content:'old summarized'},...a.slice(4,-2).map(x=>structuredClone(x.message)),structuredClone(a.at(-1).message)];
 const config=parseConfig({schemaVersion:6,profile:'balanced',storage:{mode:'memory-only'}});
 const state=createPlugin(config);const ctx={cwd:root,model:{id:'model',contextWindow:32000},getContextUsage:()=>({tokens:22000,contextWindow:32000,percent:68.75}),sessionManager:{getEntries:()=>a,getSessionId:()=>'s',getLeafId:()=>'now',getEntry:id=>a.find(e=>e.id===id)}};
 const v=applyContext(state,msgs,ctx);const observed={defect:state.telemetry.folds>0&&state.lastApplied===0,foldEvents:state.telemetry.folds,replacementsApplied:state.lastApplied,plannedFields:[...state.plan?.replacements.keys()??[]],savedTokensEstimate:state.plan?.savedTokensEstimate,returnedChangedView:v!==undefined,defaultFoldParameters:true,validRetainedBoundaryPrecedesCompaction:true};state.index.closeSync();return observed;
});
await probe('P02-sibling-exposure',()=>{
 const a=[user('u',null),call('c','u','tc'),result('r','c','tc','raw'),done('sibling','u')];const v=exposedEntryIds(a);
 return {defect:v.has('r'),crossBranchAcknowledged:[...v],currentLeaf:'r',successfulAssistantParent:'u'};
});
await probe('P03-compaction-exposure',()=>{
 const a=[user('u',null),call('c','u','tc'),result('r','c','tc','raw'),user('tail','r'),{id:'compact',parentId:'tail',type:'compaction',summary:'short',firstKeptEntryId:'tail'},done('done','compact')];return {defect:exposedEntryIds(a).has('r'),rawAcknowledgedAfterOnlySummaryWasConsumed:true};
});
await probe('P04-search-cursor-append',async()=>{
 const a=[user('a',null,'needle first'),user('b','a','needle second')];const ix=HistoryIndex.open({mode:'memory-only',dbPath:null,maxIndexBytes:1e6});const s=scope(a,'b');ix.upsertBranchSync(s,a);
 const run=(sc,cursor)=>searchHistory({scope:sc,query:'needle',limit:1,cursor,index:ix,config:cfg,getEntry:id=>a.find(e=>e.id===id)});
 const first=await run(s);a.push(call('history-call','b','ht')); const second=await run(scope(a,'history-call'),first.cursor);
 ix.closeSync();return {defect:first.hits?.[0]?.entryId===second.hits?.[0]?.entryId,first:first.hits?.[0]?.entryId,second:second.hits?.[0]?.entryId,diagnostic:second.diagnostic};
});
await probe('P05-read-cursor-target',()=>{
 const a=[user('a',null,'abcdefghij'),user('b','a','0123456789')],s=scope(a,'b');const ra=encodeRef(refForField(s,a[0],0)),rb=encodeRef(refForField(s,a[1],0));const b={maxBytes:4,maxTokens:100,estimateKind:'character-estimate'};
 const first=readHistory({scope:s,ref:ra,budget:b,config:cfg,getEntry:id=>a.find(e=>e.id===id)});const second=readHistory({scope:s,ref:rb,cursor:first.cursor,budget:b,config:cfg,getEntry:id=>a.find(e=>e.id===id)});
 return {defect:second.ok===true,firstPage:first.page,crossTargetPage:second.page,expected:'CURSOR_MISMATCH',actual:second.code};
});
await probe('P06-search-cursor-visible',async()=>{
 const a=[user('a',null,'needle first'),user('b','a','needle second')],s=scope(a,'b'),ix=HistoryIndex.open({mode:'memory-only',dbPath:null,maxIndexBytes:1e6});ix.upsertBranchSync(s,a);
 const r=await searchHistory({scope:s,query:'needle',limit:1,index:ix,config:cfg,getEntry:id=>a.find(e=>e.id===id)});const formatted=formatHistoryResult(r);ix.closeSync();return {defect:!!r.cursor&&!JSON.stringify(formatted.content).includes(r.cursor),cursorProduced:!!r.cursor,cursorInModelVisibleContent:JSON.stringify(formatted.content).includes(String(r.cursor))};
});
await probe('P07-index-cap-duplicates',()=>{
 const a=[user('a',null,'x'.repeat(100))],ix=HistoryIndex.open({mode:'memory-only',dbPath:null,maxIndexBytes:150});ix.upsertBranchSync(scope(a,'a'),a);a.push(user('b','a','needle'));
 ix.upsertBranchSync(scope(a,'b'),a);const st=ix.status(),hits=ix.searchSync(scope(a,'b'),'needle',10,0);ix.closeSync();return {defect:hits.length===0,rows:st.rows,bytes:st.bytes,warnings:st.warnings,availableCapacity:50,newTextBytes:6,found:hits.length};
});
await probe('P08-duplicate-call-batch',()=>{
 const c=call('c',null,'tc');c.message.content.push({...c.message.content[0]});const b=collectBatches([c,result('r','c','tc','ok')]);return {defect:b[0].complete,calls:b[0].calls.length,results:b[0].results.length,complete:b[0].complete};
});
await probe('P09-profile-config-hash',()=>{const s=createPlugin(cfg),old=s.configHash;setProfile(s,'observe');const n=configHashOf(s.config);s.index.closeSync();return {defect:s.configHash!==n,hashUnchanged:old===s.configHash,expectedRecomputedHashMatches:s.configHash===n}});
await probe('P10-cache-denominator',()=>{const ep={mechanism:{folds:1},foldEvents:[{at:'2026-09-09T00:00:00Z'}],requests:[0,1,2].map(i=>({at:`2026-09-09T00:00:0${i}Z`,usage:{input:100,cacheRead:60,cacheWrite:0,output:1}}))};return {defect:cacheAfterFold(ep)[0].recovered===2,correctPiDisjointCacheRatio:60/160,observed:cacheAfterFold(ep)};});
await probe('P11-false-trial-gate',()=>{
 const eps=[];const r={usage:{input:10,cacheRead:100,output:1}};
 const ep=(id,arm,rep,passed,extra={})=>({manifest:{caseId:id,arm,rep},status:'complete',oracle:{passed,...extra},requests:[r,r,r],engine:{prefixHitTokensDelta:100,prefillTokensDelta:arm==='native'?100:140},foldEvents:arm==='balanced'&&id.startsWith('H')?[{at:'x'}]:[],mechanism:{folds:arm==='balanced'&&id.startsWith('H')?1:0,nonceVerifiedReads:1,nonceFolded:true,foldedErrorResults:0}});
 for(let i=1;i<=6;i++)for(const arm of ['native','balanced'])for(let rep=0;rep<2;rep++)eps.push(ep(`L0${i}`,arm,rep,arm==='native'||rep===0));
 for(const id of ['H01','H02'])for(const arm of ['native','balanced'])for(let rep=0;rep<2;rep++)eps.push(ep(id,arm,rep,true,{quotedVerbatim:false}));
 const s=summarize(eps),d=decide(s,{qualityIds:['L01','L02','L03','L04','L05','L06'],capabilityIds:['H01','H02']},eps);
 return {defect:d.decision==='limited-balanced-trial',decision:d,qualityNative:12,qualityCandidate:6,prefillIncrease:0.4,evidenceQuoteLost:true,syntheticDiagnosticOnly:true};
});
await probe('P12-request-median',()=>{const eps=[10,100].map((w,rep)=>({manifest:{caseId:'X',arm:'native',rep},status:'complete',wallMs:w,oracle:{passed:true},requests:[]}));return {defect:summarize(eps).byCaseArm.X.native.wallP50!==55,actual:summarize(eps).byCaseArm.X.native.wallP50,expected:55};});
await probe('P13-failed-attempt-accounting',()=>{const d=join(root,'run');mkdirSync(d);const base={manifest:{caseId:'x',arm:'balanced',rep:0}};writeFileSync(join(d,'episodes.jsonl'),[{...base,status:'timeout',requests:[{usage:{input:1000}}]},{...base,status:'complete',requests:[{usage:{input:10}}]}].map(JSON.stringify).join('\n'));const loaded=loadEpisodes(d);return {defect:loaded.episodes.length===1&&loaded.priorAttempts.length===0,attemptsOnDisk:2,loadedAttempts:loaded.episodes.length,prior:loaded.priorAttempts,reportedInput:summarize(loaded.episodes).byCaseArm.x.balanced.inputSum};});
// Positive controls prove that already-fixed defects are not reopened.
await probe('P14-ref-roundtrip-fixed',()=>{const a=[user('a',null,'中文🙂abcdef')],s=scope(a,'a'),ref=encodeRef(refForField(s,a[0],0));const r=readHistory({scope:s,ref,config:cfg,getEntry:()=>a[0]});return {regressionFixed:r.ok===true&&r.page==='中文🙂abcdef',code:r.code,verified:r.verified};});
await probe('P15-search-scope-fixed',async()=>{const a=[user('same',null,'privateA')],b=[user('same',null,'privateB')],ix=HistoryIndex.open({mode:'memory-only',dbPath:null,maxIndexBytes:1e6});ix.upsertBranchSync(scope(a,'same','A'),a);ix.upsertBranchSync(scope(b,'same','B'),b);const h=ix.searchSync(scope(b,'same','B'),'privateA',10,0);ix.closeSync();return {regressionFixed:h.length===0,crossSessionHits:h.length};});
rmSync(root,{recursive:true,force:true});
writeFileSync(__OUTPUT_PATH__,JSON.stringify({source:'7478307ead72e849e9c619a913858afe8a06d38b',node:process.version,method:'actual source transpile-only + isolated core functions; not full Pi/Vitest',probes:out},null,2));console.log(JSON.stringify(out,null,2));
