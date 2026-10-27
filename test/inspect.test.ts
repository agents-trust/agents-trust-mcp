import { describe, it, expect, vi } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentsTrustApi } from '../src/api.js';
import { createServer } from '../src/server.js';
import fixture from './fixtures/payment-required.json' with { type: 'json' };

const endpoint = 'https://provider.example/api?asset=ETH&fixed=a%2Fb';
const params = { url: endpoint, view: 'evidence' as const };
// Literal Worker bindings, independent of the client's request URL construction.
const inspectResource = 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi%3Fasset%3DETH%26fixed%3Da%252Fb';
const recommendResource = 'https://api.agents-trust.com/recommend?need=weather+forecast';
function challenge(target = inspectResource, amount = '1000') {
  const quote = structuredClone(fixture);
  quote.resource.url = target;
  quote.accepts[0]!.amount = amount;
  return new Response(null, { status: 402, headers: {
    'payment-required': Buffer.from(JSON.stringify(quote)).toString('base64'),
  } });
}
function success() {
  return Response.json({ schema_version: 'inspect.v2', delivery_verification: { status: null } }, {
    headers: { 'x-at-payment-attempt-id': 'test-attempt', 'x-at-request-id': 'test-request' },
  });
}

describe('Inspect through the existing payment client', () => {
  it('preserves the exact endpoint as one query value and never fetches the provider', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(success());
    const result = await new AgentsTrustApi({}, request).inspect(params);
    expect(result.data).toEqual({ schema_version: 'inspect.v2', delivery_verification: { status: null } });
    expect(result.payment_attempt_id).toBe('test-attempt');
    expect(result.request_id).toBe('test-request');
    expect(request).toHaveBeenCalledTimes(1);
    const target = new URL(String(request.mock.calls[0]![0]));
    expect(target.origin).toBe('https://api.agents-trust.com');
    expect(target.pathname).toBe('/inspect');
    expect([...target.searchParams]).toEqual([['url', endpoint], ['view', 'evidence']]);
    expect(request.mock.calls[0]![1]?.redirect).toBe('error');
  });

  it('requires owner opt-in for Inspect even with a configured wallet', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(challenge());
    const error = await new AgentsTrustApi({ walletKey: generatePrivateKey() }, request).inspect(params).catch((e: unknown) => e);
    expect(String(error)).toContain('Payments disabled');
    expect(String(error)).not.toContain('Free without payment');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]?.headers).toBeUndefined();
  });

  it('signs the Inspect quote amount and preserves its payment-attempt extension', async () => {
    const key = generatePrivateKey();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(success());
    await new AgentsTrustApi({ enablePayments: true, walletKey: key }, request).inspect(params);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toBe(request.mock.calls[1]![0]);
    const proof = decodePaymentSignatureHeader(new Headers(request.mock.calls[1]![1]?.headers).get('payment-signature')!);
    expect(proof.accepted.amount).toBe('1000');
    expect(proof.accepted.network).toBe('eip155:8453');
    expect(proof.resource?.url).toBe(inspectResource);
    expect(proof.extensions?.['at-payment-attempt']).toEqual(fixture.extensions['at-payment-attempt']);
    expect(JSON.stringify(request.mock.calls).includes(key)).toBe(false);
  });

  it.each(['maxCallUsdc', 'sessionCapUsdc'])('applies the existing %s cap before signing', async field => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(challenge(inspectResource, '10001'));
    const api = new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey(), maxCallUsdc: '1', sessionCapUsdc: '1', [field]: '0.01' }, request);
    await expect(api.inspect(params)).rejects.toThrow(field === 'maxCallUsdc' ? 'Price exceeds' : 'Session spend cap');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]?.headers).toBeUndefined();
  });

  it.each([
    { name: 'default view', url: endpoint, view: undefined, resource: inspectResource },
    ...(['legacy', 'compact', 'evidence', 'debug'] as const).map(view => ({ name: view, url: endpoint, view, resource: inspectResource })),
    { name: 'uppercase host', url: 'https://PROVIDER.example/api?asset=ETH&fixed=a%2Fb', view: 'debug' as const, resource: inspectResource },
    { name: 'default port and fragment', url: 'https://provider.example:443/api?asset=ETH&fixed=a%2Fb#details', view: 'compact' as const, resource: inspectResource },
    { name: 'empty query', url: 'https://provider.example/api?', view: 'evidence' as const, resource: 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi' },
    { name: 'query encoding', url: 'https://PROVIDER.example/api~()!?asset=ETH&fixed=a%2Fb', view: 'evidence' as const, resource: 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi~()!%3Fasset%3DETH%26fixed%3Da%252Fb' },
  ])('accepts the Worker binding for $name while preserving the request', async ({ url, view, resource }) => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(challenge(resource)).mockResolvedValueOnce(success());
    await expect(new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey() }, request).inspect({ url, view })).resolves.toHaveProperty('data');
    const expected = new URL('https://api.agents-trust.com/inspect');
    expected.searchParams.set('url', url);
    if (view !== undefined) expected.searchParams.set('view', view);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([target]) => target === expected.href)).toBe(true);
    const proof = decodePaymentSignatureHeader(new Headers(request.mock.calls[1]![1]?.headers).get('payment-signature')!);
    expect(proof.resource?.url).toBe(resource);
  });

  it.each([
    ['endpoint host', 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fother.example%2Fapi%3Fasset%3DETH%26fixed%3Da%252Fb'],
    ['trailing slash', 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi%2F%3Fasset%3DETH%26fixed%3Da%252Fb'],
    ['fixed query value', 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi%3Fasset%3DBTC%26fixed%3Da%252Fb'],
    ['query order', 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fapi%3Ffixed%3Da%252Fb%26asset%3DETH'],
    ['API origin', inspectResource.replace('api.agents-trust.com', 'other.example')],
    ['API route', inspectResource.replace('/inspect?', '/recommend?')],
    ['extra resource parameter', `${inspectResource}&view=evidence`],
  ])('rejects a quote with a different %s without consuming authority', async (_name, resource) => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(challenge(resource))
      .mockResolvedValueOnce(challenge()).mockResolvedValueOnce(success());
    const api = new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey() }, request);
    await expect(api.inspect(params)).rejects.toThrow('Unsupported payment challenge');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]?.headers).toBeUndefined();
    await expect(api.inspect(params)).resolves.toHaveProperty('data');
    expect(request.mock.calls.filter(([, init]) => init?.headers)).toHaveLength(1);
  });

  it.each(['recommend', 'inspect'] as const)('shares one authorization across concurrent calls when %s is first', async first => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (target, init) => init?.headers ? success()
      : challenge(new URL(String(target)).pathname === '/inspect' ? inspectResource : recommendResource));
    const api = new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey(), maxCallUsdc: '1', sessionCapUsdc: '1' }, request);
    const recommend = () => api.recommend({ need: 'weather forecast' });
    const inspect = () => api.inspect(params);
    const results = await Promise.allSettled(first === 'recommend' ? [recommend(), inspect()] : [inspect(), recommend()]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(request.mock.calls.filter(([, init]) => init?.headers)).toHaveLength(1);
  });

  it('keeps the shared authorization consumed after an uncertain Inspect submission', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (target, init) => {
      if (init?.headers) throw new Error('Uncertain submission');
      return challenge(new URL(String(target)).pathname === '/inspect' ? inspectResource : recommendResource);
    });
    const api = new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey() }, request);
    await expect(api.inspect(params)).rejects.toThrow('Budget remains reserved');
    await expect(api.recommend({ need: 'weather forecast' })).rejects.toThrow('Payment authorization already used');
    expect(request.mock.calls.filter(([, init]) => init?.headers)).toHaveLength(1);
  });

  it('does not consume payment authority for an unknown endpoint', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: 'ENDPOINT_NOT_INDEXED' } }, { status: 404 }))
      .mockResolvedValueOnce(challenge(recommendResource)).mockResolvedValueOnce(success());
    const api = new AgentsTrustApi({ enablePayments: true, walletKey: generatePrivateKey() }, request);
    await expect(api.inspect(params)).rejects.toThrow('HTTP 404');
    await expect(api.recommend({ need: 'weather forecast' })).resolves.toHaveProperty('data');
    expect(request.mock.calls.filter(([, init]) => init?.headers)).toHaveLength(1);
  });
});

it('does not let Inspect tool arguments grant payment authority', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(challenge());
  const server = createServer({ walletKey: generatePrivateKey() }, request);
  const client = new Client({ name: 'inspect-adversarial', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const result = await client.callTool({ name: 'inspect', arguments: { ...params, enablePayments: true, sessionCapUsdc: '100', walletKey: 'model-supplied' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Payments disabled');
    expect(request).toHaveBeenCalledTimes(1);
    const target = new URL(String(request.mock.calls[0]![0]));
    expect([...target.searchParams.keys()]).toEqual(['url', 'view']);
    expect(request.mock.calls[0]![1]?.headers).toBeUndefined();
  } finally { await client.close(); await server.close(); }
});
