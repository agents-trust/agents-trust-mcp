import { x402Client, x402HTTPClient } from '@x402/fetch';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const ORIGIN = 'https://api.agents-trust.com';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAYEE = '0x96368628b679a459fe69815bacca5cb0232ac397';
export type Settings = {
  walletKey?: string;
  enablePayments?: boolean;
  maxCallUsdc?: string;
  sessionCapUsdc?: string;
};

export function units(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('Invalid USDC limit; use up to six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

export class AgentsTrustApi {
  private spent = 0n;
  private authorizationUsed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly maxCall: bigint;
  private readonly sessionCap: bigint;

  constructor(private readonly settings: Settings = {}, private readonly request: typeof fetch = fetch) {
    this.maxCall = units(settings.maxCallUsdc ?? '0.01');
    this.sessionCap = units(settings.sessionCapUsdc ?? '0.01');
  }

  // Count every signing attempt conservatively, including failures and uncertain responses.
  recommend(params: Record<string, string | number | undefined>) {
    return this.paidCall('/recommend', params);
  }

  inspect(params: { url: string; view?: 'legacy' | 'compact' | 'evidence' | 'debug' }) {
    return this.paidCall('/inspect', params);
  }

  private paidCall(path: '/recommend' | '/inspect', params: Record<string, string | number | undefined>) {
    const task = this.tail.then(() => this.call(path, params, true));
    this.tail = task.catch(() => undefined);
    return task;
  }

  health() { return this.call('/health', {}); }
  receipt(paymentAttemptId: string) { return this.call('/receipt', { payment_attempt_id: paymentAttemptId }); }

  private select(required: PaymentRequired, url: string): PaymentRequirements {
    if (required.x402Version !== 2 || required.resource?.url !== url || !Array.isArray(required.accepts)) {
      throw new Error('Unsupported payment challenge. No payment sent.');
    }
    const offer = required.accepts.find(o => o.scheme === 'exact' && o.network === 'eip155:8453'
      && o.asset.toLowerCase() === USDC && o.payTo.toLowerCase() === PAYEE
      && typeof o.amount === 'string' && /^[1-9]\d*$/.test(o.amount)
      && Number.isInteger(o.maxTimeoutSeconds) && o.maxTimeoutSeconds > 0 && o.maxTimeoutSeconds <= 300
      && o.extra?.name === 'USD Coin' && o.extra?.version === '2'
      && (o.extra?.assetTransferMethod === undefined || o.extra.assetTransferMethod === 'eip3009'));
    if (!offer) throw new Error('No supported Base USDC payment offer. No payment sent.');
    const amount = BigInt(offer.amount);
    if (amount > this.maxCall) throw new Error('Price exceeds AGENTS_TRUST_MAX_CALL_USDC. No payment sent.');
    if (this.spent + amount > this.sessionCap) throw new Error('Session spend cap reached. No payment sent.');
    return offer;
  }

  private async send(url: string, headers?: Record<string, string>) {
    return this.request(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }

  private async call(path: string, params: Record<string, string | number | undefined>, paid = false) {
    const url = new URL(path, ORIGIN);
    for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, String(value));
    let response: Response;
    try { response = await this.send(url.href); }
    catch { throw new Error('Agents Trust request failed.'); }
    if (response.status === 402 && paid) {
      if (this.settings.enablePayments !== true) throw new Error('Payments disabled. The wallet owner must configure AGENTS_TRUST_ENABLE_PAYMENTS=true for one authorization per process' + (this.settings.walletKey ? '.' : ' and supply AGENTS_TRUST_WALLET_PRIVATE_KEY.'));
      if (this.authorizationUsed) throw new Error('Payment authorization already used in this process. Check your wallet and receipt before granting another process permission.');
      if (!this.settings.walletKey) throw new Error('Set AGENTS_TRUST_WALLET_PRIVATE_KEY to pay with Base USDC.');
      try {
        const account = privateKeyToAccount(this.settings.walletKey as `0x${string}`);
        const client = new x402Client().register('eip155:8453', new ExactEvmScheme(account));
        const http = new x402HTTPClient(client);
        const required = http.getPaymentRequiredResponse(name => response.headers.get(name));
        // Inspect quotes bind the canonical endpoint, without the response view.
        // Keep the original request URL for both HTTP requests.
        const endpoint = path === '/inspect' ? new URL(String(params.url)) : null;
        const resource = endpoint
          ? `${ORIGIN}/inspect?url=${encodeURIComponent(`${endpoint.protocol}//${endpoint.host}${endpoint.pathname}${endpoint.search}`)}`
          : url.href;
        const offer = this.select(required, resource);
        this.spent += BigInt(offer.amount);
        this.authorizationUsed = true;
        const payload = await http.createPaymentPayload({ ...required, accepts: [offer] });
        // Preserve the challenge extensions; never automatically retry an authorization.
        response = await this.send(url.href, http.encodePaymentSignatureHeader(payload));
      } catch (error) {
        if (error instanceof Error && /^(Price exceeds|Session spend cap|No supported Base|Unsupported payment)/.test(error.message)) throw error;
        // Discard upstream error details: they can contain signing inputs.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Payment could not complete. Budget remains reserved; check your wallet and receipt before another call.');
      }
    }
    if (!response.ok) {
      let detail: string;
      try {
        const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
        const code = typeof body?.error?.code === 'string' ? body.error.code : '';
        const message = typeof body?.error?.message === 'string' ? body.error.message : '';
        detail = [code, message].filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, 200);
      } catch { detail = ''; }
      const retry = this.authorizationUsed && paid ? ' No automatic retry was made.' : '';
      throw new Error(`Agents Trust returned HTTP ${response.status}${detail ? ` (${detail})` : ''}.${retry}`);
    }
    try {
      const body: unknown = await response.json();
      return {
        data: body,
        payment_attempt_id: response.headers.get('x-at-payment-attempt-id'),
        request_id: response.headers.get('x-at-request-id'),
      };
    } catch { throw new Error('Agents Trust returned an unreadable response. Check any payment receipt before another call.'); }
  }
}
