import './build-guard.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
