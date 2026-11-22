import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ArionPayClient, configFromEnv, createServer, DocsIndex, loadSnapshot } from "../dist/index.js";

const KEY = "pk_test12345678";
const SECRET = "sk_secret_for_tests";

/** A fake ArionPay: records requests, answers from `routes`. */
function fakeApi(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, search: u.search, headers: init.headers, body: init.body });
    const route = routes[`${init.method} ${u.pathname}`];
    const answer = typeof route === "function" ? route(calls.at(-1), calls.length) : route;
    const [status, data] = answer ?? [404, { error: "Not found" }];
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

async function connect(env, routes) {
  const config = configFromEnv(env);
  const api = fakeApi(routes);
  const client = new ArionPayClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, apiSecret: config.apiSecret, fetch: api.fetchImpl });
  const server = createServer(config, { client });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return { mcp, api, close: () => mcp.close() };
}
const text = (r) => r.content.map((c) => c.text).join("\n");
const keys = { ARIONPAY_API_KEY: KEY, ARIONPAY_API_SECRET: SECRET };

test("settings: defaults, and refusals of half or odd settings", () => {
  const c = configFromEnv({});
  assert.deepEqual(c, { apiKey: undefined, apiSecret: undefined, baseUrl: "https://merchant.arionpay.com", live: false, maxAmount: 1000, readOnly: false });
  assert.equal(configFromEnv({ ...keys, ARIONPAY_LIVE: "true", ARIONPAY_MAX_AMOUNT: "250" }).maxAmount, 250);
  assert.throws(() => configFromEnv({ ARIONPAY_API_KEY: KEY }), /ARIONPAY_API_SECRET is missing/);
  assert.throws(() => configFromEnv({ ARIONPAY_API_SECRET: SECRET }), /ARIONPAY_API_KEY is missing/);
  assert.throws(() => configFromEnv({ ARIONPAY_API_KEY: "sk_wrongkind1234", ARIONPAY_API_SECRET: SECRET }), /starts with pk_/);
  assert.throws(() => configFromEnv({ ARIONPAY_BASE_URL: "http://evil.example" }), /https/);
  assert.equal(configFromEnv({ ARIONPAY_BASE_URL: "http://127.0.0.1:18090/" }).baseUrl, "http://127.0.0.1:18090");
  assert.throws(() => configFromEnv({ ARIONPAY_MAX_AMOUNT: "-5" }), /above 0/);
});

test("signing: GET signs path + query with a fresh nonce, POST signs the exact body", async () => {
  const api = fakeApi({ "GET /api/v1/store": [200, { id: "s1", name: "Shop" }], "POST /api/v1/invoices": [201, { id: "i1" }] });
  const c = new ArionPayClient({ baseUrl: "https://example.test", apiKey: KEY, apiSecret: SECRET, fetch: api.fetchImpl });
  await c.signedGet("/api/v1/store");
  await c.signedGet("/api/v1/store");
  await c.signedPost("/api/v1/invoices", { amount: "1.00" });
  const [g1, g2, p] = api.calls;
  const ts = g1.headers["x-timestamp"];
  assert.equal(g1.headers["x-api-key"], KEY);
  assert.equal(g1.headers["x-signature"], createHmac("sha256", SECRET).update(`${ts}.GET ${g1.path}${g1.search}`).digest("hex"));
  assert.match(g1.search, /nonce=[0-9a-f]{16}/);
  assert.notEqual(g1.search, g2.search);
  assert.equal(p.headers["x-signature"], createHmac("sha256", SECRET).update(`${p.headers["x-timestamp"]}.${p.body}`).digest("hex"));
  assert.ok(!JSON.stringify(api.calls).includes(SECRET), "the secret itself is never sent");
});

test("a request refused as 'already used' is signed again once", async () => {
  const api = fakeApi({ "POST /api/v1/invoices": (_c, n) => (n === 1 ? [401, { error: "This signed request was already used. Sign each request with a fresh timestamp." }] : [201, { id: "i1" }]) });
  const c = new ArionPayClient({ baseUrl: "https://example.test", apiKey: KEY, apiSecret: SECRET, fetch: api.fetchImpl });
  assert.deepEqual(await c.signedPost("/api/v1/invoices", { a: 1 }), { id: "i1" });
  assert.equal(api.calls.length, 2);
});

test("docs search finds the right pages", () => {
  const idx = new DocsIndex(loadSnapshot());
  assert.equal(idx.search("verify webhook signature")[0]?.path, "/knowledge-base/hmac-webhook-verification");
  assert.ok(idx.search("laravel package install").some((h) => h.path === "/libraries/laravel"));
  assert.ok(idx.search("woocommerce plugin").some((h) => h.path === "/plugins/woocommerce"));
  assert.ok(idx.search("underpayment tolerance").length > 0);
  assert.equal(idx.page("nodejs")?.path, "/libraries/nodejs");
  assert.equal(idx.page("https://arionpay.com/docs/")?.path, "/docs");
  assert.ok(idx.integrations().length >= 30);
});

test("without keys: docs and public tools only", async () => {
  const { mcp, close } = await connect({});
  const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_api_reference", "get_doc_page", "get_rates", "list_coins", "list_integrations", "search_docs"]);
  const r = await mcp.callTool({ name: "get_api_reference", arguments: { endpoint: "GET /api/v1/invoices/:id" } });
  assert.match(text(r), /Get an invoice/);
  const list = await mcp.callTool({ name: "get_api_reference", arguments: {} });
  assert.match(text(list), /GET \/api\/v1\/invoices"/);
  assert.match(mcp.getInstructions() ?? "", /No store keys are set/);
  await close();
});

test("with keys: store tools; read-only leaves out every write tool", async () => {
  const all = await connect(keys);
  const names = (await all.mcp.listTools()).tools.map((t) => t.name);
  for (const n of ["check_connection", "list_invoices", "get_invoice", "create_invoice", "simulate_payment", "send_test_webhook"]) assert.ok(names.includes(n), n);
  await all.close();
  const ro = await connect({ ...keys, ARIONPAY_READ_ONLY: "1" });
  const roNames = (await ro.mcp.listTools()).tools.map((t) => t.name);
  assert.ok(roNames.includes("list_invoices") && !roNames.includes("create_invoice") && !roNames.includes("simulate_payment") && !roNames.includes("send_test_webhook"));
  await ro.close();
});

test("create_invoice: test by default, real only when allowed and under the maximum, never sets webhook or redirect addresses", async () => {
  const created = [201, { status: "success", id: "6b0000000000000000000001", invoice_url: "https://merchant.arionpay.com/pay/6b0000000000000000000001", data: { status: "new", amount_fiat: 10, currency: "USD", expires_at: "2026-11-22T20:00:00Z" } }];
  const t = await connect(keys, { "POST /api/v1/invoices": created });
  const r = await t.mcp.callTool({ name: "create_invoice", arguments: { amount: "10.00", orderId: "A1", description: "Mug" } });
  assert.ok(!r.isError, text(r));
  const body = JSON.parse(t.api.calls[0].body);
  assert.equal(body.test, true);
  assert.match(body.idempotencyKey, /^mcp-[0-9a-f]{24}$/);
  for (const k of ["callbackUrl", "successUrl", "cancelUrl", "metadata", "returnUrl"]) assert.ok(!(k in body), k);
  assert.match(text(r), /Test invoice/);

  const real = await t.mcp.callTool({ name: "create_invoice", arguments: { amount: 10, test: false } });
  assert.ok(real.isError);
  assert.match(text(real), /Real invoices are switched off/);
  assert.equal(t.api.calls.length, 1);
  await t.close();

  const live = await connect({ ...keys, ARIONPAY_LIVE: "true", ARIONPAY_MAX_AMOUNT: "100" }, { "POST /api/v1/invoices": created });
  const big = await live.mcp.callTool({ name: "create_invoice", arguments: { amount: "150", test: false } });
  assert.ok(big.isError);
  assert.match(text(big), /up to 100/);
  const okReal = await live.mcp.callTool({ name: "create_invoice", arguments: { amount: "99.99", test: false } });
  assert.ok(!okReal.isError, text(okReal));
  assert.equal(JSON.parse(live.api.calls[0].body).test, false);
  // a big TEST invoice is fine (no money)
  assert.ok(!(await live.mcp.callTool({ name: "create_invoice", arguments: { amount: "5000" } })).isError);
  await live.close();
});

test("API errors come back as tool errors with a hint, never as a crash", async () => {
  const t = await connect(keys, { "GET /api/v1/store": [401, { error: "Invalid signature" }] });
  const r = await t.mcp.callTool({ name: "check_connection", arguments: {} });
  assert.ok(r.isError);
  assert.match(text(r), /Invalid signature.*ARIONPAY_API_KEY/s);
  const bad = await t.mcp.callTool({ name: "get_invoice", arguments: { invoiceId: "nope" } });
  assert.ok(bad.isError);
  await t.close();
});

test("one version everywhere: package.json, server.json (twice) and the server", async () => {
  const { readFileSync } = await import("node:fs");
  const { VERSION } = await import("../dist/index.js");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const reg = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
  assert.equal(reg.version, pkg.version);
  assert.equal(reg.packages[0].version, pkg.version);
  assert.equal(reg.name, pkg.mcpName);
  assert.equal(reg.packages[0].identifier, pkg.name);
  assert.ok(reg.description.length <= 100, "registry limit: 100 characters");
});
