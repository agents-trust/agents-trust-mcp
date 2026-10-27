import { it, expect, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { AgentsTrustApi } from '../src/api.js';
import fixture from './fixtures/payment-required.json' with { type: 'json' };

// Always local, even when a launcher has injected a real wallet or live-test flag.
it.each(['recommend', 'inspect'] as const)('cryptographically binds %s authorization to the pinned amount, recipient, asset and chain', async route => {
  const key = generatePrivateKey();
  const challenge = structuredClone(fixture);
  const endpoint = 'https://PROVIDER.example:443/endpoint~()!?asset=ETH&currency=USD#details';
  const url = route === 'recommend' ? 'https://api.agents-trust.com/recommend?need=weather'
    : `https://api.agents-trust.com/inspect?${new URLSearchParams({ url: endpoint, view: 'evidence' })}`;
  challenge.resource.url = route === 'recommend' ? url
    : 'https://api.agents-trust.com/inspect?url=https%3A%2F%2Fprovider.example%2Fendpoint~()!%3Fasset%3DETH%26currency%3DUSD';
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 402, headers: {
      'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64'),
    } }))
    .mockResolvedValueOnce(Response.json({ picks: [] }));
  const api = new AgentsTrustApi({ enablePayments: true, walletKey: key }, request);
  if (route === 'recommend') await api.recommend({ need: 'weather' });
  else await api.inspect({ url: endpoint, view: 'evidence' });
  expect(request.mock.calls.every(([target]) => target === url)).toBe(true);
  const payload = decodePaymentSignatureHeader(new Headers(request.mock.calls[1]![1]?.headers).get('payment-signature')!);
  expect(payload.resource?.url).toBe(challenge.resource.url);
  const { authorization, signature } = payload.payload as {
    authorization: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };
    signature: `0x${string}`;
  };
  expect(authorization.from).toBe(privateKeyToAccount(key).address);
  expect(authorization.to.toLowerCase()).toBe('0x96368628b679a459fe69815bacca5cb0232ac397');
  expect(authorization.value).toBe('10000');
  expect(BigInt(authorization.validBefore) - BigInt(Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(300n);
  const domain = { name: 'USD Coin', version: '2', chainId: 8453,
    verifyingContract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const };
  const types = { TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ] } as const;
  const message = { ...authorization, value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) };
  const signed = { address: authorization.from, domain, types, primaryType: 'TransferWithAuthorization' as const, message, signature };
  expect(await verifyTypedData(signed)).toBe(true);
  expect(await verifyTypedData({ ...signed, message: { ...message, value: 10001n } })).toBe(false);
  expect(await verifyTypedData({ ...signed, domain: { ...domain, chainId: 1 } })).toBe(false);
  expect(JSON.stringify(request.mock.calls).includes(key)).toBe(false);
});
