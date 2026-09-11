const ts=require('typescript'),fs=require('fs'),path=require('path');
const repo=process.argv[2],out=process.argv[3];
function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.ts')){const dest=path.join(out,path.relative(repo,f).replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:false}}).outputText)}}}
walk(path.join(repo,'src'));fs.writeFileSync(path.join(out,'package.json'),' {"type":"module"}\n'); console.log(JSON.stringify({node:process.version,ts:ts.version,transpileOnly:true,out}));
