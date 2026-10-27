import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePrivateKey } from 'viem/accounts';
import { unzipSync } from 'fflate';

// Build entry points must explicitly refuse a wallet variable. Successful
// builds inherit only PATH, never the launcher's credentials or the canary.
const key = generatePrivateKey();
for (const args of [['run', 'build'], ['run', 'bundle']]) {
  const rejected = spawnSync('npm', args, {
    env: { PATH: process.env.PATH, AGENTS_TRUST_WALLET_PRIVATE_KEY: key }, encoding: 'utf8',
  });
  assert.equal(rejected.status, 1, 'Wallet-bearing build must fail');
  assert.ok(rejected.stderr?.includes('Build refused: remove AGENTS_TRUST_WALLET_PRIVATE_KEY'), 'Build must explicitly refuse the wallet variable');
  assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(key), 'Build refusal must not echo the key');
}
// Direct packaging must also refuse a wallet, even if compilation is bypassed.
const rejected = spawnSync(process.execPath, ['scripts/bundle.mjs'], {
  env: { PATH: process.env.PATH, AGENTS_TRUST_WALLET_PRIVATE_KEY: key }, encoding: 'utf8',
});
assert.equal(rejected.status, 1);
assert.ok(rejected.stderr?.includes('Build refused: remove AGENTS_TRUST_WALLET_PRIVATE_KEY'));
assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(key));
function run(command, args) {
  try {
    return execFileSync(command, args, {
      env: { PATH: process.env.PATH },
      stdio: 'pipe', maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    // Do not include child output or error objects in build logs.
    throw new Error('Artifact build/check subprocess failed.');
  }
}
run('npm', ['run', 'build']);
const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(tmpdir(), 'at-npm-cache')]).toString())[0];
run(process.execPath, ['scripts/bundle.mjs']);
const bundle = unzipSync(await readFile('agents-trust.mcpb'));
const roots = new Set(['package.json', 'package-lock.json', 'manifest.json', 'README.md', 'LICENSE', 'dist', 'node_modules']);
assert.ok(Object.keys(bundle).every(p => roots.has(p.split('/')[0])));
assert.ok(Object.keys(bundle).every(p => !p.split('/').some(s => s.startsWith('.env') || s.endsWith('.pem'))));
assert.ok(bundle['manifest.json'] && bundle['dist/index.js']);
const manifest = JSON.parse(Buffer.from(bundle['manifest.json']).toString());
assert.equal(manifest.user_config.wallet_key.sensitive, true);
assert.equal(manifest.user_config.enable_payments.default, false);
assert.equal(manifest.server.mcp_config.env.AGENTS_TRUST_ENABLE_PAYMENTS, '${user_config.enable_payments}');
const metadata = JSON.parse(Buffer.from(bundle['package.json']).toString());
assert.notEqual(metadata.private, true);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [path, bytes] of Object.entries(bundle)) {
  if (path.startsWith('node_modules/') && path.endsWith('/package.json')) {
    const installed = JSON.parse(Buffer.from(bytes).toString());
    const lockedPath = path.slice(0, -'/package.json'.length);
    if (lock.packages[lockedPath]) assert.equal(installed.version, lock.packages[lockedPath].version);
  }
}
const variants = [key, key.slice(2), Buffer.from(key).toString('base64')].map(s => Buffer.from(s));
for (const bytes of Object.values(bundle)) {
  assert.ok(variants.every(secret => !Buffer.from(bytes).includes(secret)), 'Canary leaked into MCPB');
}
const tarPaths = run('tar', ['-tzf', pack.filename]).toString().trim().split('\n').filter(p => !p.endsWith('/'));
assert.ok(tarPaths.every(p => /^package\/(dist\/|package\.json$|README\.md$|LICENSE$|server\.json$)/.test(p)));
const tarBytes = run('tar', ['-xOzf', pack.filename]);
assert.ok(variants.every(secret => !tarBytes.includes(secret)), 'Canary leaked into npm archive');
async function compareDist(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compareDist(path);
    else {
      const name = relative('.', path).split('\\').join('/');
      const source = await readFile(path);
      assert.ok(source.equals(Buffer.from(bundle[name] ?? [])), 'MCPB dist differs from build');
      assert.ok(source.equals(run('tar', ['-xOzf', pack.filename, 'package/' + name])), 'npm dist differs from build');
    }
  }
}
await compareDist('dist');
console.log(`Artifact checks passed: build/bundle explicitly refuse wallet variable; ${tarPaths.length} npm files; ${Object.keys(bundle).length} MCPB files; matching dist, locked runtime versions, disabled payment default, no canary or credential files.`);
