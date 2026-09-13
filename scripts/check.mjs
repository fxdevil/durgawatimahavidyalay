import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.mjs', ...['lib', 'public/js', 'tests'].flatMap(folder => readdirSync(folder).filter(name => /\.(mjs|js)$/.test(name)).map(name => `${folder}/${name}`))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
console.log(`Syntax checks passed for ${files.length} files.`);
