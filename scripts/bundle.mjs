import './build-guard.mjs';
import { mkdtemp, cp, copyFile, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';

const staging = await mkdtemp(join(tmpdir(), 'agents-trust-bundle-'));
try {
  for (const file of ['package.json','package-lock.json','manifest.json','README.md','LICENSE']) {
    await copyFile(file, join(staging, file));
  }
  await cp('dist', join(staging, 'dist'), { recursive: true });
  execFileSync('npm', ['ci','--omit=dev','--ignore-scripts','--bin-links=false','--cache',join(tmpdir(),'at-npm-cache')], { cwd: staging, stdio: 'inherit' });
  // MCPB is a ZIP with manifest.json at its root. Build only the explicit staging
  // tree; no dynamic CLI download, signing tool, home directory or user config.
  const files = Object.create(null);
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await collect(join(directory, entry.name), name + '/');
      else if (entry.isFile()) files[name] = await readFile(join(directory, entry.name));
      else throw new Error('Bundle staging contains an unsupported file type.');
    }
  }
  await collect(staging);
  await writeFile(resolve('agents-trust.mcpb'), zipSync(files, { level: 6 }));
} finally { await rm(staging, { recursive: true, force: true }); }
