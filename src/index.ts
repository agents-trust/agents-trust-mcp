#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  const server = createServer({
    enablePayments: process.env.AGENTS_TRUST_ENABLE_PAYMENTS === 'true',
    walletKey: process.env.AGENTS_TRUST_WALLET_PRIVATE_KEY,
    maxCallUsdc: process.env.AGENTS_TRUST_MAX_CALL_USDC,
    sessionCapUsdc: process.env.AGENTS_TRUST_SESSION_CAP_USDC,
  });
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write('Agents Trust could not start. Check wallet and USDC limit configuration.\n');
  process.exitCode = 1;
}
