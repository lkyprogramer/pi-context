#!/usr/bin/env node
/** No network, no writes to the audited repository. Actual modules are transpiled,
 * not reimplemented. This is NOT a typecheck or real Pi/provider test.
 * Usage: node run_source_probes.mjs /path/to/repo /path/to/new-output.json
 * Normally resolves TypeScript from repo. Explicit audit alternative:
 * TYPESCRIPT_MODULE_PATH=/absolute/path/to/typescript.js node ...
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const [repoArg,outArg]=process.argv.slice(2);
if(!repoArg || !outArg) throw new Error('Usage: node run_source_probes.mjs REPO OUT');
const repo=path.resolve(repoArg),output=path.resolve(outArg);
if(fs.existsSync(output)) throw new Error('Output exists; use a new evidence filename');
if(!fs.existsSync(path.join(repo,'src/plugin.ts'))) throw new Error('Unsupported source layout');
const req=createRequire(path.join(repo,'package.json'));
let ts;
try {ts=req(process.env.TYPESCRIPT_MODULE_PATH || 'typescript');}
catch {throw new Error('TypeScript missing. Install locked repo dependencies, or explicitly supply TYPESCRIPT_MODULE_PATH for a labeled surrogate audit.');}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-first-probe-'));
const build=path.join(root,'probe-build');
try{
  fs.mkdirSync(build,{recursive:true});
  for(const dir of ['src','eval']){
    const walk=p=>{
      for(const e of fs.readdirSync(p,{withFileTypes:true})){
        const f=path.join(p,e.name);
        if(e.isDirectory()) walk(f);
        else if(f.endsWith('.ts') && !f.endsWith('.d.ts')){
          const dest=path.join(build,path.relative(repo,f)).replace(/\.ts$/,'.js');
          fs.mkdirSync(path.dirname(dest),{recursive:true});
          const result=ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
          fs.writeFileSync(dest,result.outputText);
        }
      }
    };
    if(fs.existsSync(path.join(repo,dir)))walk(path.join(repo,dir));
  }
  fs.writeFileSync(path.join(build,'package.json'),' {"type":"module"}\n');
  const here=path.dirname(fileURLToPath(import.meta.url));
  fs.copyFileSync(path.join(here,'../reference/probe-cases.mjs'),path.join(root,'probe.mjs'));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const p=spawnSync(process.execPath,[path.join(root,'probe.mjs'),output],{encoding:'utf8',timeout:30000});
  if(p.status!==0)throw new Error(`Probe runner failed (${p.status}): ${p.stderr}`);
  const data=JSON.parse(fs.readFileSync(output,'utf8'));
  data.compilerVersion=ts.version;
  data.warning='Observed failures from current actual source; executing a probe is not a product pass. Synthetic markers only.';
  fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
  const errors=data.results.filter(r=>'probeError' in r);
  console.log(JSON.stringify({observations:data.results.length,probeErrors:errors.length,node:process.version,typescript:ts.version,output}));
  if(errors.length){ console.error(JSON.stringify(errors)); process.exitCode=2; }
}finally{fs.rmSync(root,{recursive:true,force:true});}
