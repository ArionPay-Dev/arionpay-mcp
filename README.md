# ArionPay MCP server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for [ArionPay](https://arionpay.com), the
non-custodial crypto payment gateway. Your AI assistant (Claude, Cursor, VS Code Copilot and other MCP apps) can:

- **answer ArionPay questions and write integration code**: it searches the ArionPay docs, API reference, plugin and
  library guides. No account or keys needed.
- **work with your store**: create an invoice and get its payment link, check whether an order was paid, list today's
  payments, and try a payment in test mode.

ArionPay never holds your money: customers pay straight into your own wallet.

## Tools

| Tool | What it does | Needs keys |
| --- | --- | --- |
| `search_docs` | Searches the ArionPay help pages (API, webhooks, test mode, payment rules, fees, 24 plugins, 8 libraries) | no |
| `get_doc_page` | Reads one page, e.g. `/docs`, `/libraries/python`, `/plugins/woocommerce` | no |
| `list_integrations` | Every plugin and library, with its guide | no |
| `get_api_reference` | The REST API from its OpenAPI description, one endpoint or all | no |
| `list_coins` | Coins and networks a checkout can offer right now (live) | no |
| `get_rates` | Current coin prices in a fiat currency (live) | no |
| `check_connection` | Checks your keys and names the store | yes |
| `list_invoices` | Your invoices, newest first, filter by status, date or order ID | yes |
| `get_invoice` | One invoice: status, coin, amounts, confirmations, transaction | yes |
| `create_invoice` | Creates an invoice and returns its payment link | yes |
| `simulate_payment` | Pays a **test** invoice in a chosen scenario (exact, underpaid, late …) | yes |
| `send_test_webhook` | Sends a signed sample event to your shop's webhook | yes |

The docs tools read a copy of the public pages of arionpay.com that ships inside the package: they work offline and
send nothing anywhere.

## Set up

You need Node.js 20 or newer. The server runs on your own computer; your AI app starts it.

**Docs only (no keys)** — add the server without any environment variables.

**With your store** — in the [ArionPay dashboard](https://merchant.arionpay.com) open **Stores → your store** and copy
the API key (`pk_…`) and the API secret (`sk_…`). Tip: make a separate store for your assistant, so you can see its
invoices apart and replace its keys without touching your shop.

### Claude Desktop

Settings → Developer → Edit config, then add:

```json
{
  "mcpServers": {
    "arionpay": {
      "command": "npx",
      "args": ["-y", "@arionpay/mcp"],
      "env": {
        "ARIONPAY_API_KEY": "pk_...",
        "ARIONPAY_API_SECRET": "sk_..."
      }
    }
  }
}
```

### Claude Code

```sh
claude mcp add arionpay -e ARIONPAY_API_KEY=pk_... -e ARIONPAY_API_SECRET=sk_... -- npx -y @arionpay/mcp
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project): the same `mcpServers` block as for Claude
Desktop.

### VS Code

`.vscode/mcp.json` — VS Code asks for the secret once and stores it for you:

```json
{
  "inputs": [
    { "type": "promptString", "id": "arionpay-secret", "description": "ArionPay API secret (sk_...)", "password": true }
  ],
  "servers": {
    "arionpay": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@arionpay/mcp"],
      "env": {
        "ARIONPAY_API_KEY": "pk_...",
        "ARIONPAY_API_SECRET": "${input:arionpay-secret}"
      }
    }
  }
}
```

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARIONPAY_API_KEY` | – | Store API key (`pk_…`). Without key and secret only the docs and public tools are offered. |
| `ARIONPAY_API_SECRET` | – | Store API secret (`sk_…`). |
| `ARIONPAY_LIVE` | off | `true` allows **real** invoices, and only when the assistant asks for one (`test: false`). Off: every invoice is a test invoice. |
| `ARIONPAY_MAX_AMOUNT` | `1000` | Largest real invoice, in the invoice's own currency. |
| `ARIONPAY_READ_ONLY` | off | `true` leaves out `create_invoice`, `simulate_payment` and `send_test_webhook`. |
| `ARIONPAY_BASE_URL` | `https://merchant.arionpay.com` | Only for testing against another ArionPay server. |

## Safety

- Your keys stay in your settings on your computer. No tool takes a key, so they never pass through the chat.
- Test mode by default. Real invoices need `ARIONPAY_LIVE=true` **and** an explicit request, and stay under
  `ARIONPAY_MAX_AMOUNT`.
- The assistant can create and read invoices, nothing more. There is no tool for wallets, API secrets, webhook
  settings, payouts or marking an invoice paid, and `create_invoice` cannot set webhook or redirect addresses: text
  the assistant read somewhere else cannot send your payment notices or your customers to another address.
- A test invoice moves no money. An order is paid only when `get_invoice` says `PAID` and `test` is `false` — and
  your shop should confirm orders from the signed webhook, as always.

## Try it

- "How do I verify an ArionPay webhook in Laravel?"
- "Create a test invoice for 25 USD for order 1042, paid in USDT on TRON, then simulate the payment."
- "Which of today's invoices are paid?"
- "Is invoice 6b03… paid? How many confirmations does it have?"

## Development

```sh
npm install
npm test                      # builds, then runs the tests
npm run docs-snapshot -- <path to a build of the arionpay.com website (dist)>
```

`src/docs-snapshot.json` is generated from the public pages of a website build; regenerate it when the docs change.

## Licence

MIT
