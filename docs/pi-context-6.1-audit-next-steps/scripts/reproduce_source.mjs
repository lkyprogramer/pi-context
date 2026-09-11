#!/usr/bin/env node
// Execute synthetic audit probes on actual local source. No network, no model, no source edits.
// Use only on a repository you trust: imported modules are executable code.
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2), val=k=>{const i=args.indexOf(k);return i<0?null:args[i+1]};
if(!val('--repo')||!val('--out')){console.error('Usage: node scripts/reproduce_source.mjs --repo /path/to/pi-context --out /path/to/probes.json');process.exit(2)}
const repo=resolve(val('--repo')), out=resolve(val('--out')), here=dirname(fileURLToPath(import.meta.url));
if(!existsSync(join(repo,'src/plugin.ts')))throw new Error('Repository source not found');
const temp=mkdtempSync(join(tmpdir(),'pctx-source-review-'));
try {
  const global=spawnSync('npm',['root','-g'],{encoding:'utf8',timeout:10000});
  const nodePath=[join(repo,'node_modules'),global.status===0?global.stdout.trim():'',process.env.NODE_PATH??''].filter(Boolean).join(':');
  const tr=spawnSync(process.execPath,[join(here,'transpile.cjs'),repo,join(temp,'compiled')],{encoding:'utf8',timeout:45000,env:{...process.env,NODE_PATH:nodePath}});
  if(tr.status!==0){process.stderr.write(tr.stderr||'TypeScript transpiler unavailable\n');process.exitCode=3}
  else{
    process.stdout.write(tr.stdout);
    const body=readFileSync(join(here,'source-probes.template.mjs'),'utf8')
      .replace('__REPORT_URL__',JSON.stringify(pathToFileURL(join(repo,'eval/local/report.mjs')).href))
      .replace('__OUTPUT_PATH__',JSON.stringify(out));
    mkdirSync(dirname(out),{recursive:true});writeFileSync(join(temp,'probes.mjs'),body);
    const run=spawnSync(process.execPath,[join(temp,'probes.mjs')],{encoding:'utf8',timeout:45000});
    process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
    if(run.status!==0)process.exitCode=run.status??3;
    else{
      const data=JSON.parse(readFileSync(out,'utf8'));
      data.probeDesignBaseline=data.source; delete data.source;
      const h=createHash('sha256');
      function hashDir(dir){for(const ent of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(dir,ent.name);if(ent.isDirectory())hashDir(file);else if(ent.isFile()){h.update(file.slice(repo.length+1));h.update('\0');h.update(readFileSync(file));}}}
      hashDir(join(repo,'src'));h.update(readFileSync(join(repo,'eval/local/report.mjs')));
      data.executedSourceDigest=h.digest('hex');
      const git=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8',timeout:10000});
      data.executedRepoGitHead=git.status===0?git.stdout.trim():null;
      writeFileSync(out,JSON.stringify(data,null,2)+'\n');
      const failed=data.probes.filter(p=>!p.executed);
      console.log(JSON.stringify({executed:data.probes.length-failed.length,unexecuted:failed.length,
        counterexamples:data.probes.filter(p=>p.defect===true).length,positiveControls:data.probes.filter(p=>p.regressionFixed===true).length,
        warning:'Diagnostic source execution only; not supported Pi/Vitest acceptance; repaired code can change APIs.'}));
      if(failed.length)process.exitCode=4;
    }
  }
} finally {rmSync(temp,{recursive:true,force:true})}
