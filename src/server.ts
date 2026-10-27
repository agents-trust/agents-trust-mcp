import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentsTrustApi, type Settings } from './api.js';

export function createServer(settings: Settings = {}, request: typeof fetch = fetch) {
  const api = new AgentsTrustApi(settings, request);
  const server = new McpServer({ name: 'agents-trust', version: '0.1.0' });
  const run = async (action: () => Promise<unknown>) => {
    try {
      let text = JSON.stringify(await action());
      if (settings.walletKey) text = text.split(settings.walletKey).join('[redacted]');
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      let text = error instanceof Error ? error.message : 'Agents Trust request failed.';
      if (settings.walletKey) text = text.split(settings.walletKey).join('[redacted]');
      return { isError: true, content: [{ type: 'text' as const, text }] };
    }
  };
  server.registerTool('recommend', {
    description: 'Find APIs for your task, with URLs, prices and call details. Payment requires owner opt-in and consumes the process’s single authorization, up to the configured USDC limit.',
    inputSchema: {
      need: z.string().refine(s => Array.from(s).length >= 2 && Array.from(s).length <= 300 && /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(s), 'Use 2–300 characters with at least two letters or digits.'),
      limit: z.number().int().min(1).max(5).optional(),
      live: z.literal(1).optional(),
      max_price_usd: z.number().finite().min(0).optional().describe('Maximum provider price; separate from the recommendation fee.'),
      chain: z.string().regex(/^[a-z0-9-]{2,16}:[A-Za-z0-9_=-]{1,64}$/).optional(),
      view: z.enum(['legacy', 'compact', 'evidence']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, args => run(() => api.recommend(args)));
  server.registerTool('inspect', {
    description: 'Read stored evidence for one exact API endpoint URL, without calling or paying that provider. The Inspect fee is 1% of the endpoint\'s lowest quoted price, with a 0.001 USDC floor. Read the actual quote. Payment requires owner opt-in and shares the process\'s single authorization and USDC limits with Recommend.',
    inputSchema: {
      url: z.string().min(1).max(2048).refine(value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch { return false; }
      }, 'Use an absolute HTTPS endpoint URL without credentials.').describe('Exact endpoint URL, including its fixed query parameters. The API rejects private URLs before payment.'),
      view: z.enum(['legacy', 'compact', 'evidence', 'debug']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, args => run(() => api.inspect(args)));
  server.registerTool('receipt', {
    description: 'Look up payment settlement by payment attempt ID. Free.',
    inputSchema: { payment_attempt_id: z.uuid({ version: 'v7' }) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, args => run(() => api.receipt(args.payment_attempt_id)));
  server.registerTool('health', {
    description: 'Read the Agents Trust service version. Free.', inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, () => run(() => api.health()));
  return server;
}
