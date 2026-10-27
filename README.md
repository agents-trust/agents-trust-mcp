# Agents Trust MCP

Find APIs for your task from Claude Desktop, Cursor or Claude Code. Recommendations include URLs, prices and call details. Inspect returns the stored evidence for one exact endpoint URL. This stdio server runs on your computer. Paid calls use your own wallet; Agents Trust holds no wallet keys.

Runtime requires Node.js 20 or later. Install from npm; your MCP host starts it over standard input/output:

```sh
npx -y @agents-trust/mcp
```

Supply a wallet only to the runtime launcher (see Configuration). To build from source instead, see Development.

## Tools and cost

| Tool | Input | Result | Fee |
| --- | --- | --- | --- |
| `recommend` | `need`; optional `limit`, `live`, `max_price_usd`, `chain`, `view` | APIs for your task and call details | 0.01 USDC outside the free demos |
| `inspect` | `url`; optional `view` | Stored endpoint evidence without calling the provider | 1% of the endpoint's lowest quoted price, minimum 0.001 USDC |
| `receipt` | `payment_attempt_id` | Eventual settlement result | Free |
| `health` | none | Service version | Free |

Ask your host to call `inspect` with an exact endpoint URL from a recommendation. Preserve its fixed query parameters. For `inspect`, `view` accepts `legacy`, `compact`, `evidence` or `debug`; for `recommend` it accepts `legacy`, `compact` or `evidence`. Omitting it uses the API's legacy response. An unknown URL returns an unpaid 404. The API rejects malformed, credential-bearing and private URLs before payment. Inspect never calls or purchases the provider's service.

`recommend` inputs: `need` is 2–300 characters with at least two letters or digits; `limit` is 1–5; `live` may be `1` to prefer recently verified endpoints; `chain` is a CAIP-2 network such as `eip155:8453`; `max_price_usd` is a non-negative number. `receipt` takes the `payment_attempt_id` returned with a paid answer (a UUID version 7).

Example: ask your host to call `recommend` with `{"need":"weather","view":"compact"}`. Free demos may change. `max_price_usd` limits a recommended provider's price; it does not limit the recommendation fee. Calling a recommended API is a separate purchase.

A paid answer includes `payment_attempt_id` when available. Use `receipt` to check settlement; receiving an answer does not confirm settlement. A pending receipt can be looked up again for free.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_TRUST_ENABLE_PAYMENTS` | unset / disabled | Owner opt-in: exact `true` grants at most one payment authorization per server process |
| `AGENTS_TRUST_WALLET_PRIVATE_KEY` | unset | Your EVM private key, with `0x` prefix; needed for paid calls |
| `AGENTS_TRUST_MAX_CALL_USDC` | `0.01` | Maximum fee for one Recommend or Inspect call in USDC |
| `AGENTS_TRUST_SESSION_CAP_USDC` | `0.01` | Maximum reserved spend for one server process |

Payments stay disabled even when a wallet key is present. The wallet owner can explicitly supply `AGENTS_TRUST_ENABLE_PAYMENTS=true` in the local launcher or select the bundle’s payment opt-in. This grants the process one authorization within the monetary caps; there is no per-call human confirmation. An agent tool argument, service response or provider instruction cannot grant payment authority. Use a dedicated low-balance wallet with USDC on **Base mainnet**. The server signs x402 authorizations locally and sends them only to `https://api.agents-trust.com`. It accepts the published Base USDC asset and Agents Trust payment address. A changed address requires a server update. Other payment networks are unsupported.

Limits accept non-negative decimal strings with up to six decimal places. Zero disables paid calls. Reservations count signing attempts, including failed or uncertain requests, and remain reserved until the process exits. The process consumes its single authorization before signing, even if signing or the request fails. Raising a monetary cap does not allow a second authorization. Free calls and receipts remain available. Restarting the server resets both the session cap and the authorization grant. Stop the host from automatically restarting with payment opt-in until the wallet owner has reconciled prior attempts. Recommend and Inspect share the same grant, reservation cap and serialized payment queue, including concurrent calls. Paid submissions are never automatically repeated. On an uncertain result, check your wallet and any receipt before making another paid call.

Without a key, free tools and free demo recommendations work. A paid Recommend or Inspect request returns a message explaining which variable to configure. Keep keys out of chat, version control and shell history. Have your local secret manager or host supply the wallet variable to the child process.

### Claude Desktop

Merge this into `claude_desktop_config.json`. The free configuration requires no key:

```json
{
  "mcpServers": {
    "agents-trust": {
      "command": "npx",
      "args": ["-y", "@agents-trust/mcp"],
      "env": {
        "AGENTS_TRUST_MAX_CALL_USDC": "0.01",
        "AGENTS_TRUST_SESSION_CAP_USDC": "0.01"
      }
    }
  }
}
```

For paid calls, explicitly grant `AGENTS_TRUST_ENABLE_PAYMENTS=true` and supply `AGENTS_TRUST_WALLET_PRIVATE_KEY` to this process through your secure local launcher. GUI applications need the full path to your Node executable and do not always inherit your terminal environment.

### Cursor

Use the same `mcpServers` block in `~/.cursor/mcp.json` or `.cursor/mcp.json`, adding `"type": "stdio"` to the server entry ([Cursor configuration](https://cursor.com/docs/mcp)). To read a key already injected into Cursor's environment, add this entry to the server's `env` object:

```json
"AGENTS_TRUST_WALLET_PRIVATE_KEY": "${env:AGENTS_TRUST_WALLET_PRIVATE_KEY}"
```

Keep wallet configuration local; do not commit it.

### Claude Code

```sh
claude mcp add --transport stdio agents-trust -- npx -y @agents-trust/mcp
```

See [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp). Launch Claude Code with payment opt-in chosen by the wallet owner and the wallet variable supplied by your secret manager. The server inherits it from the host.

## Development

Build from source in a shell without `AGENTS_TRUST_WALLET_PRIVATE_KEY`; the build and bundle commands refuse that variable even when it is empty.

```sh
git clone https://github.com/agents-trust/agents-trust-mcp.git
cd agents-trust-mcp
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Run the local server with `node dist/index.js`. Standard output carries MCP messages only. Tests generate throwaway keys in memory and make no payments. Development tests require Node.js 22.13+ or 24; CI also checks the built stdio server on Node.js 20.

`npm run test:paid` is an offline cryptographic authorization test using a generated throwaway key and mocked HTTP. No test reads a funded wallet or submits a real payment. Dependency installation scripts are disabled by `.npmrc`; use `npm ci` to preserve the reviewed lockfile. The bundle packer is also locked locally.

MIT licensed. See [LICENSE](LICENSE).
