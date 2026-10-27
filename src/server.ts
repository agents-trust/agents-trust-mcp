import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentsTrustApi, type Settings } from './api.js';

const RESULT = 'Returns JSON {data, payment_attempt_id, request_id}; payment_attempt_id is set only after a paid answer, for use with receipt.';
const PAYMENT = 'Pays only if the wallet owner set AGENTS_TRUST_ENABLE_PAYMENTS=true and AGENTS_TRUST_WALLET_PRIVATE_KEY (Base USDC): one paid call per process, at most AGENTS_TRUST_MAX_CALL_USDC (default 0.01), never retried. Otherwise it errors without paying; errors and empty results are free.';

export function createServer(settings: Settings = {}, request: typeof fetch = fetch) {
  const api = new AgentsTrustApi(settings, request);
  const server = new McpServer({ name: 'agents-trust', version: '0.1.3' });
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
    title: 'Recommend paid APIs for a task',
    description: [
      'Find which paid x402 API to call for a task described in plain words, ranked with evidence. Each pick has the endpoint URL, provider price and payment network, a ready request template, liveness, delivery evidence and risk flags.',
      'Use it when you do not yet know which API to call; use inspect instead when you already have one exact endpoint URL, and receipt to confirm settlement after paying.',
      'Write need as the task itself ("current weather in Paris"), not a product name; narrow with max_price_usd or chain, and use view=compact to save tokens.',
      'Weather, crypto prices and web search are free demo needs; other needs cost 0.01 USDC.',
      PAYMENT, RESULT, 'data.picks may be shorter than limit, or empty, when evidence is insufficient.',
    ].join(' '),
    inputSchema: {
      need: z.string().refine(s => Array.from(s).length >= 2 && Array.from(s).length <= 300 && /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(s), 'Use 2–300 characters with at least two letters or digits.')
        .describe('The work you need done, in plain words, e.g. "weather forecast for Berlin" or "translate text to German". 2–300 characters with at least two letters or digits.'),
      limit: z.number().int().min(1).max(5).optional().describe('Maximum number of picks, 1–5. Default 3.'),
      live: z.literal(1).optional().describe('Only 1 is accepted, which is also the default: prefer endpoints with recent liveness evidence.'),
      max_price_usd: z.number().finite().min(0).optional().describe('Highest provider price per call in USD you accept. Separate from the 0.01 USDC recommendation fee; the provider\'s own quote at call time is authoritative.'),
      chain: z.string().regex(/^[a-z0-9-]{2,16}:[A-Za-z0-9_=-]{1,64}$/).optional().describe('Only return providers that accept payment on this network, as a CAIP-2 id, e.g. eip155:8453 for Base.'),
      view: z.enum(['legacy', 'compact', 'evidence']).optional().describe('Response detail: compact (smallest, pick essentials and request template), evidence (adds ranking, liveness, delivery and payment evidence per pick) or legacy (default, original field layout).'),
    },
    annotations: { title: 'Recommend paid APIs for a task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, args => run(() => api.recommend(args)));
  server.registerTool('inspect', {
    title: 'Inspect evidence for one endpoint',
    description: [
      'Read the stored evidence for one exact x402 endpoint URL: price, payment networks, liveness, delivery history and risk flags. It never calls or pays the endpoint itself.',
      'Use it before paying an endpoint you already know, for example one returned by recommend; use recommend instead to find candidates for a task.',
      'Pass url exactly as listed: paths and trailing slashes are distinct. Use view=compact for essentials only.',
      'Demo endpoints are free; other indexed endpoints cost 1% of the endpoint\'s lowest quoted price, minimum 0.001 USDC. An unindexed URL returns ENDPOINT_NOT_INDEXED without payment.',
      PAYMENT, RESULT,
      'data.endpoint holds price (min_usd, max_usd), networks and payment_offers, liveness (is_live, last probe time; compact and evidence views), delivery_verification (status, charged and charged-not-delivered counts), risk_flags and invocation (request schema); data.lookup shows the canonical URL matched.',
    ].join(' '),
    inputSchema: {
      url: z.string().min(1).max(2048).refine(value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch { return false; }
      }, 'Use an absolute HTTPS endpoint URL without credentials.').describe('Exact public HTTPS endpoint URL, including any fixed query parameters, e.g. a pick\'s url from recommend. Private, malformed and credential-bearing URLs are rejected before payment.'),
      view: z.enum(['legacy', 'compact', 'evidence', 'debug']).optional().describe('Response detail: compact (smallest), evidence (full evidence blocks), legacy (default, original field layout) or debug (adds diagnostic fields).'),
    },
    annotations: { title: 'Inspect evidence for one endpoint', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, args => run(() => api.inspect(args)));
  server.registerTool('receipt', {
    title: 'Check payment settlement',
    description: [
      'Check whether a paid recommend or inspect answer has settled on-chain. Free, read-only, and never repeats the paid request.',
      'Use it after a paid call, with the payment_attempt_id that call returned; answers arrive before settlement completes.',
      'Returns data.state (pending, settled, settle_failed_after_answer or settle_unknown_after_answer) and data.transaction (transaction hash once settled, else null).',
      'An unknown id returns a not-found error. Pending or unavailable does not prove that no money moved: check the wallet before paying again.',
    ].join(' '),
    inputSchema: {
      payment_attempt_id: z.uuid({ version: 'v7' }).describe('The payment_attempt_id returned by a paid recommend or inspect call: a lowercase UUIDv7. Copy it unchanged.'),
    },
    annotations: { title: 'Check payment settlement', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, args => run(() => api.receipt(args.payment_attempt_id)));
  server.registerTool('health', {
    title: 'Check service version',
    description: [
      'Check that the Agents Trust API is reachable and read its deployed version. Free, read-only, no parameters.',
      'Use it to diagnose connection problems before retrying recommend or inspect; it does not measure data freshness.',
      'Returns data.status ("ok") and data.version (deployment identifier).',
    ].join(' '),
    inputSchema: {},
    annotations: { title: 'Check service version', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, () => run(() => api.health()));
  return server;
}
