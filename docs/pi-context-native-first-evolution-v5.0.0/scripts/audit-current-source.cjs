// Audit-only runner: transpiles exact source modules, not the product test suite.
// Usage: node audit-probes.cjs /absolute/path/to/pi-context [output.json]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const crypto = require('node:crypto');
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript')); }
const root=path.resolve(process.argv[2]||'.');
const touched=new Map();
function loader(host={}) {
 const cache=new Map();
 function load(file) {
   file=path.resolve(file);
   if (cache.has(file)) return cache.get(file).exports;
   const src=fs.readFileSync(file,'utf8');
   touched.set(path.relative(root,file),crypto.createHash('sha256').update(src).digest('hex'));
   const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText;
   const m={exports:{}}; cache.set(file,m);
   function req(spec) {
     if(spec==='@earendil-works/pi-coding-agent') return host;
     if(spec==='@pcr/contracts') return load(path.join(root,'packages/contracts/src/index.ts'));
     if(spec.startsWith('.')) {let f=path.resolve(path.dirname(file),spec);if(f.endsWith('.js'))f=f.slice(0,-3)+'.ts';return load(f);}
     if(spec.startsWith('node:'))return require(spec);
     throw new Error('AUDIT_UNSUPPORTED_IMPORT '+spec);
   }
   vm.runInThisContext('(function(require,module,exports,__filename,__dirname){'+out+'\n})',{filename:file})(req,m,m.exports,file,path.dirname(file));
   return m.exports;
 }
 return f=>load(path.join(root,f));
}
(async()=>{
 const rows=[]; const load=loader();
 const env=load('packages/runtime/src/observation-envelope.ts');
 const read=load('packages/core/src/reducers/read.ts');
 const prod=load('packages/core/src/reducers/production.ts');
 const estimate=load('packages/core/src/budget/pricer.ts').estimateTextTokens;
 const base={format:'pcr-observation-v1',toolCallId:'call_a',toolName:'read',content:[],details:null,isError:false};
 function probe(id, f){try{rows.push({id,...f()});}catch(e){rows.push({id,runnerError:String(e)});}}
 probe('A01-stock-host-guard',()=>{let error=null;try{load('packages/pi-adapter/src/user-input-hook.ts')}catch(e){error=e.message;}return {observed:error,regressionReproduced:error==='PCR_PI_INGRESS_METADATA_CONTRACT_MISSING',scope:'module loading with an unpatched-export-shape stub; not a real Pi loader'};});
 probe('A02-image-view-loss',()=>{
   const v=env.renderObservationView({original:{...base,content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='}]},reducedText:'',evidenceId:'ev_image',budgetTokens:500,estimate});
   return {mode:v.mode,outputTypes:v.content.map(b=>b.type),regressionReproduced:!v.content.some(b=>b.type==='image')};
 });
 probe('A03-view-budget-not-enforced',()=>{
   const text='X'.repeat(20000);const v=env.renderObservationView({original:{...base,content:[{type:'text',text}]},reducedText:text,evidenceId:'ev_long',budgetTokens:500,estimate});
   const tokens=estimate(v.content.map(b=>b.text||'').join(''));return {mode:v.mode,budget:500,estimatedOutputTokens:tokens,regressionReproduced:tokens>500};
 });
 probe('A04-read-first-exposure-tail-loss',()=>{
   const text='a'.repeat(4100)+'\nCRITICAL_CONTRACT: do_not_write_audit_schema';const r=read.reduceReadResult(text,{path:'src/OrderService.java',rawBlobId:'raw_example'});return {originalContainsMarker:true,viewContainsMarker:r.visibleText.includes('CRITICAL_CONTRACT'),visibleCharacters:r.visibleText.length,regressionReproduced:!r.visibleText.includes('CRITICAL_CONTRACT')};
 });
 probe('A05-shared-object-not-a-cycle',()=>{
   const shared={tag:'same-reference'};let error=null;try{env.encodeObservation({...base,content:[{type:'text',text:'x'}],details:{left:shared,right:shared}})}catch(e){error={message:e.message,details:e.details}}return {jsonStringifyWorks:!!JSON.stringify({left:shared,right:shared}),observed:error,regressionReproduced:error?.details?.reason==='cyclic'};
 });
 probe('A06-unknown-block-composition',()=>{
   const original=[{type:'vendor-attachment',data:'x'.repeat(4000)}];const normalized=env.toHostVisibleContent(original);const v=env.renderObservationView({original:{...base,content:normalized},reducedText:'',evidenceId:'ev_unknown',budgetTokens:500,estimate});return {normalizedTypes:normalized.map(b=>b.type),mode:v.mode,outputTypes:v.content.map(b=>b.type),regressionReproduced:!v.content.some(b=>b.type==='bypass'),scope:'future/third-party content boundary; current official tool-result type is text|image'};
 });
 probe('A07-maven-classifier',()=>{
   const input={toolName:'bash',args:{command:'mvn test'}};const eligible=prod.createProductionReducers().filter(r=>r.supports(input)).map(r=>r.id);return {eligibleReducers:eligible,firstMatch:eligible[0],observation:'command arguments do not route ordinary bash Maven output into test-log reducer',regressionReproduced:eligible[0]==='bash'};
 });
 const patched=loader({PCR_INGRESS_METADATA_CONTRACT:'pcr-ingress-metadata-v1'});
 const hook=patched('packages/pi-adapter/src/user-input-hook.ts');
 const handlers=new Map();let aborted=0;let captures=0;let failurePhase=null;
 hook.registerUserInputHook({on:(event,handler)=>handlers.set(event,handler)},{cursor:()=>({}),service:()=>{captures++;return{}},clock:{now:()=>0},onHardFailure:(_,p)=>{failurePhase=p}});
 const result=await handlers.get('input')({type:'input',text:'inspect screenshot',source:'interactive',images:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='}]},{abort:()=>{aborted++;}});
 rows.push({id:'A08-input-image-rejection',action:result.action,aborted,captures,failurePhase,regressionReproduced:result.action==='reject'&&aborted===1,scope:'real registered handler with host context stub'});
 const report={kind:'audit-component-probes',sourceCommit:'e14804daf9aa31b342ddca718d789fa6860c2244',node:process.version,typescript:ts.version,realPiHostExecuted:false,fullSuiteExecuted:false,rows,sourceFiles:Object.fromEntries(touched)};
 const json=JSON.stringify(report,null,2)+'\n';if(process.argv[3])fs.writeFileSync(process.argv[3],json);console.log(json);
 if(rows.some(r=>r.runnerError))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
