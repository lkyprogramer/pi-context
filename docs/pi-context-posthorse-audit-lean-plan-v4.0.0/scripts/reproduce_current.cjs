// Isolated source execution: original TypeScript transpiled in memory; no Pi/provider run.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const repo=path.resolve(process.argv[2] || '.');
let ts; try { ts=require(require.resolve('typescript',{paths:[repo,process.cwd()]})); }
catch { ts=require('typescript'); }
const root=repo; const cache=new Map();const loaded=[];
function load(p){p=path.resolve(p);if(cache.has(p))return cache.get(p).exports; const src=fs.readFileSync(p,'utf8'); const mod={exports:{}};cache.set(p,mod);loaded.push({path:path.relative(root,p),sha256:crypto.createHash('sha256').update(src).digest('hex')});
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const req=(n)=>{if(n==='@pcr/contracts')return load(path.join(root,'packages/contracts/src/index.ts'));if(n.startsWith('.')){let q=path.resolve(path.dirname(p),n);if(q.endsWith('.js'))q=q.slice(0,-3)+'.ts';return load(q);}return require(n)};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){'+js+'\n})',{filename:p})(req,mod,mod.exports,p,path.dirname(p));return mod.exports;}
(async()=>{
let checks=[];const cursor={workspaceId:'ws_'+'a'.repeat(40),sessionId:'s1',leafId:'leaf-A',lineageHash:'b'.repeat(64),modelKey:'provider/model'};
const probe=load(root+'/packages/benchmark/src/scoring/probe.ts');
const cases=[['valid-cited-refusal','no','否。检查点 checkpoint v2 abc 明确冻结 public API，不得修改。','yes-no'],['valid-refusal-no-citation','no','否。不得修改 public API。','yes-no'],['contradictory-refusal','no','No. Actually, yes, you may modify the public API now.','yes-no']];
for(const [id,expected,observed,family] of cases)checks.push({id,result:probe.scoreProbe({expected,observed,family})});
const codec=load(root+'/packages/pi-adapter/src/message-codec.ts').createMessageCodec({cursor});
const raws=[{role:'user',content:'Run two tests',timestamp:1},{role:'assistant',content:[{type:'toolCall',id:'call-1',name:'bash',arguments:{command:'test one'}}],timestamp:2},{role:'toolResult',toolCallId:'call-1',toolName:'bash',content:[{type:'text',text:'OK'}],timestamp:3},{role:'assistant',content:[{type:'toolCall',id:'call-2',name:'bash',arguments:{command:'test two'}}],timestamp:4},{role:'toolResult',toolCallId:'call-2',toolName:'bash',content:[{type:'text',text:'OK'}],timestamp:5}];
const env=raws.map((raw,i)=>codec.wrap({cursor,raw,entryId:'e'+i}));const dedup=load(root+'/packages/core/src/materialization/dedup.ts').dedupMaterializationMessages([],[],env.map(x=>x.normalized));
checks.push({id:'distinct-active-tool-events-content-dedup',inputIds:env.map(x=>x.hostMessageId),keptIds:dedup.active.map(x=>x.hostMessageId),inputCount:env.length,keptCount:dedup.active.length,keptToolCallIds:dedup.active.filter(x=>x.toolCallId).map(x=>x.toolCallId)});
let captured;const blobs={put:async(c,bytes)=>{captured=Buffer.from(bytes);return'blob_'+crypto.createHash('sha256').update(bytes).digest('hex')},read:async()=>captured};const saga={prepare:async()=>{},markHostVisible:async()=>{}};
const observation=load(root+'/packages/runtime/src/observation-service.ts').createObservationService({cursor,blobs,saga});
const res=await observation.ingest({operationId:'op1',cursor,toolCallId:'call1',toolName:'bash',args:{command:'mvn test'},content:[{type:'text',text:'FAILED: UserServiceTest; exit=1'}],details:null,isError:true,capturedAt:1,sourceClass:'untrusted-tool',authority:'inform'});
checks.push({id:'inner-visible-pointer-only',storedUtf8:captured.toString(),visibleContent:res.visibleContent,containsFailure:JSON.stringify(res.visibleContent).includes('UserServiceTest')});
const hooks={};let ingested;const toolHook=load(root+'/packages/pi-adapter/src/tool-result-hook.ts');
toolHook.registerToolResultHook({on:(n,f)=>hooks[n]=f},{cursor:()=>cursor,clock:{now:()=>1},service:()=>({ingest:async input=>{ingested=input;return{...res,visibleContent:input.content}},acknowledge:async()=>{}}),onHardFailure:()=>{}});
const image={type:'image',mimeType:'image/png',data:'c3ludGhldGlj'};await hooks.tool_result({toolName:'read',toolCallId:'image-read',content:[image],input:{path:'x.png'},isError:false},{abort:()=>{}});
checks.push({id:'image-erased-before-raw-store',originalTypes:['image'],ingestedContent:ingested.content});
const evmod=load(root+'/packages/runtime/src/evidence-service.ts');let record;const repository={put:async r=>{record=r},get:async()=>record};const fts={upsert:async()=>{},search:async()=>[]};
const writer=evmod.createEvidenceService({cursor,repository,fts,blobs});const list=await writer.admit({cursor,operationId:'op1',observationId:'obs1',rawBlobId:res.rawBlobId,reducer:{id:'r',revision:'1'},sourceClass:'untrusted-tool',facts:[{kind:'test',value:'failed'}],observedAt:1});
const next={...cursor,leafId:'leaf-B',lineageHash:'c'.repeat(64)};const reader=evmod.createEvidenceService({cursor:next,repository,fts,blobs});let err;
try{await reader.read({cursor:next,evidenceId:list[0].evidenceId});}catch(e){err=e.code}
checks.push({id:'next-leaf-read-original-evidence',oldLeaf:cursor.leafId,currentLeaf:next.leafId,result:err,explanation:'Repository supplies the real prior record; production repository/FTS also impose exact cursor equality.'});
const out={kind:'isolated-original-source-execution',node:process.version,fullPi:false,networkCalls:0,sourceEdits:false,checks,loaded};
fs.writeFileSync(path.resolve(process.argv[3] || 'pcr-source-repro.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({kind:out.kind,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
