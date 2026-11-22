# Changelog

## 1.0.1

- Listed in the official MCP Registry as `io.github.ArionPay-Dev/arionpay-mcp` (published from GitHub Actions).
- Published from GitHub with npm trusted publishing (staged: each version is approved by a maintainer with 2FA) and provenance.
- The server version is read from package.json.

## 1.0.0

First release.

- Docs tools (no keys, offline): `search_docs`, `get_doc_page`, `list_integrations`, `get_api_reference`.
- Live public tools: `list_coins`, `get_rates`.
- Store tools (with `ARIONPAY_API_KEY` and `ARIONPAY_API_SECRET`): `check_connection`, `list_invoices`, `get_invoice`,
  `create_invoice`, `simulate_payment`, `send_test_webhook`.
- Test invoices by default; real invoices only with `ARIONPAY_LIVE=true`, an explicit request and below
  `ARIONPAY_MAX_AMOUNT`; `ARIONPAY_READ_ONLY` for reading only.
- `list_invoices` needs ArionPay v2.0.61 or newer on the server (`GET /api/v1/invoices`).
