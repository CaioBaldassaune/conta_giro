import ts from "typescript";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir(".domain-tests",{recursive:true});
for(const name of ["domain","importer","seed","persistence-query","contagiro","reporting"]){const input=await readFile(`lib/${name}.ts`,"utf8");const output=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(['"])\.\/(domain|contagiro|reporting)\1/g, '$1./$2.mjs$1');await writeFile(`.domain-tests/${name}.mjs`,output);}
const result=spawnSync(process.execPath,["--test","tests/domain.test.mjs","tests/contagiro.test.mjs"],{stdio:"inherit"});process.exit(result.status??1);
