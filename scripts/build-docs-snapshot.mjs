#!/usr/bin/env node
/**
 * Builds src/docs-snapshot.json: the text of the public ArionPay help pages (English), the OpenAPI description and
 * llms-full.txt, from a build of the arionpay.com website.
 *
 *   node scripts/build-docs-snapshot.mjs <website dist folder>
 *
 * Only public pages are read (the same text anyone sees on arionpay.com). The snapshot ships inside the package, so
 * search works offline and does not depend on the website answering automated requests.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2];
if (!dist || !existsSync(join(dist, "index.html"))) {
  console.error("usage: node scripts/build-docs-snapshot.mjs <website dist folder>");
  process.exit(1);
}

/** Help pages worth searching: guides, API, integrations, coins, payment features. Not legal or marketing pages. */
const PAGES = [
  "docs", "get-started", "technical-setup", "accept-payments", "crypto-invoice", "crypto-wallet", "currencies", "pricing",
  "payment-links", "payment-buttons", "payment-radar", "white-label-payment-gateway", "no-kyc-crypto-payment-gateway",
  "n8n-crypto-payment-gateway", "telegram-bot-checkout", "swap", "security", "security/bug-bounty", "roadmap", "integrations", "plugins",
];
const PREFIXES = ["knowledge-base", "libraries", "plugins", "coins"];

const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Visible text of <main>, with headings marked (#, ##, ###) and list items as "- ". */
function pageText(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? "";
  let s = main
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|aside)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\`\`\`\n${decode(code.replace(/<[^>]+>/g, ""))}\n\`\`\`\n`);
  s = s
    .replace(/<h1\b[^>]*>/gi, "\n# ")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h[4-6]\b[^>]*>/gi, "\n#### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|ul|ol|dt|dd|summary|details|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  const lines = [];
  let inCode = false;
  for (const raw of s.split("\n")) {
    if (raw.trim() === "```") inCode = !inCode;
    const line = inCode ? raw.replace(/\s+$/, "") : decode(raw).replace(/\s+/g, " ").trim();
    if (!line && !inCode) continue;
    if (lines.length && lines.at(-1) === line && !inCode) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

/** Split into sections at ## headings; the part before the first ## belongs to the page title. */
function sections(text) {
  const out = [];
  let title = "";
  let cur = { heading: "", lines: [] };
  for (const line of text.split("\n")) {
    if (line.startsWith("# ") && !title) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      if (cur.lines.length) out.push(cur);
      cur = { heading: line.slice(3).trim(), lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  if (cur.lines.length) out.push(cur);
  return { title, sections: out.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })).filter((s) => s.text.length > 20) };
}

const wanted = new Set(PAGES);
const pages = [];
const listDirs = (dir) => {
  const all = [];
  for (const prefix of PREFIXES) {
    const base = join(dir, prefix);
    if (!existsSync(base)) continue;
    all.push(prefix);
    for (const sub of readdirSafe(base)) if (existsSync(join(base, sub, "index.html"))) all.push(`${prefix}/${sub}`);
  }
  return all;
};
function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
for (const p of listDirs(dist)) wanted.add(p);

for (const path of [...wanted].sort()) {
  const file = join(dist, path, "index.html");
  if (!existsSync(file)) continue;
  const { title, sections: secs } = sections(pageText(readFileSync(file, "utf8")));
  if (!secs.length) continue;
  pages.push({ path: `/${path}`, url: `https://arionpay.com/${path}`, title, sections: secs });
}

const openapi = existsSync(join(dist, "openapi.json")) ? JSON.parse(readFileSync(join(dist, "openapi.json"), "utf8")) : null;
const llms = existsSync(join(dist, "llms-full.txt")) ? readFileSync(join(dist, "llms-full.txt"), "utf8") : "";
if (llms) pages.push({ path: "/llms-full.txt", url: "https://arionpay.com/llms-full.txt", title: "ArionPay facts and API summary", sections: sections(`# ArionPay\n${llms.replace(/^# .*\n/, "")}`).sections });

const snapshot = { generatedAt: new Date().toISOString().slice(0, 10), source: "arionpay.com", pages, openapi };
writeFileSync(new URL("../src/docs-snapshot.json", import.meta.url), JSON.stringify(snapshot));
const chars = pages.reduce((n, p) => n + p.sections.reduce((m, s) => m + s.text.length, 0), 0);
console.log(`docs snapshot: ${pages.length} pages, ${pages.reduce((n, p) => n + p.sections.length, 0)} sections, ${Math.round(chars / 1024)} KB of text, OpenAPI ${openapi ? Object.keys(openapi.paths ?? {}).length + " paths" : "missing"}`);
