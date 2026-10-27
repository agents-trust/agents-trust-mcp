import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'stdio-smoke', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', chunk => { stderr += String(chunk); });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name), ['recommend','inspect','receipt','health']);
  if (process.argv.includes('--live')) {
    const result = await client.callTool({ name: 'health', arguments: {} });
    assert.ok(!result.isError, 'Live health returned an error');
    console.log('Live free health through stdio: passed');
  }
  assert.equal(stderr, '');
  console.log('Stdio initialization and tools/list: passed');
} finally { await client.close(); }
