/**
 * Search over the bundled snapshot of the public ArionPay help pages (scripts/build-docs-snapshot.mjs). Offline:
 * no request leaves the computer. Plain BM25 over sections, with extra weight for words in page titles and headings.
 */
import { readFileSync } from "node:fs";

export interface DocSection {
  heading: string;
  text: string;
}
export interface DocPage {
  path: string;
  url: string;
  title: string;
  sections: DocSection[];
}
export interface DocsSnapshot {
  generatedAt: string;
  source: string;
  pages: DocPage[];
  openapi: { paths?: Record<string, Record<string, OpenApiOperation>>; [k: string]: unknown } | null;
}
export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: unknown;
  security?: unknown;
}
export interface SearchHit {
  title: string;
  heading: string;
  url: string;
  path: string;
  excerpt: string;
  score: number;
}

/** Navigation lists, not content. */
const SKIP_HEADINGS = /^(related guides|related pages|guides and next steps|developer libraries|more integrations|guides for developers)$/i;
const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its my of on or so that the this to was what when where which who why will with you your me we our there their them then than also not no yes into about use using".split(" "),
);

/** Light English stemming, so "verifying" finds "verify" and "signatures" finds "signature". */
export function stem(w: string): string {
  if (w.length <= 4 || /[0-9_./@]/.test(w)) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_.@/-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[./@-]+|[./@-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

interface Doc {
  page: DocPage;
  section: DocSection;
  tf: Map<string, number>;
  len: number;
}

export class DocsIndex {
  private readonly docs: Doc[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(readonly snapshot: DocsSnapshot) {
    for (const page of snapshot.pages) {
      for (const section of page.sections) {
        if (SKIP_HEADINGS.test(section.heading)) continue;
        const tf = new Map<string, number>();
        const add = (words: string[], weight: number) => {
          for (const w of words) tf.set(w, (tf.get(w) ?? 0) + weight);
        };
        add(tokenize(section.text), 1);
        add(tokenize(section.heading), 3);
        add(tokenize(page.title), 2);
        let len = 0;
        for (const v of tf.values()) len += v;
        this.docs.push({ page, section, tf, len });
        for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      }
    }
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, limit = 5): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.75;
    const scored: Array<{ d: Doc; score: number }> = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched++;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
      }
      // the main guides first: plugin pages repeat the same general questions
      const weight = /^\/(docs|pricing|knowledge-base|llms-full\.txt)/.test(d.page.path) ? 1.25 : 1;
      if (score > 0) scored.push({ d, score: score * weight * (0.5 + matched / terms.length) });
    }
    scored.sort((x, y) => y.score - x.score);
    const out: SearchHit[] = [];
    const perPage = new Map<string, number>();
    for (const { d, score } of scored) {
      const used = perPage.get(d.page.path) ?? 0;
      if (used >= 2) continue; // at most two sections of one page
      perPage.set(d.page.path, used + 1);
      out.push({ title: d.page.title, heading: d.section.heading, url: d.page.url, path: d.page.path, excerpt: excerpt(d.section.text, terms), score: Math.round(score * 100) / 100 });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** A page by its path ("/libraries/nodejs"), its last part ("nodejs") or its URL. */
  page(ref: string): DocPage | undefined {
    const r = ref.trim().replace(/^https?:\/\/(www\.)?arionpay\.com/i, "").replace(/\/+$/, "").toLowerCase();
    const path = r.startsWith("/") ? r : `/${r}`;
    return (
      this.snapshot.pages.find((p) => p.path === path) ??
      this.snapshot.pages.find((p) => p.path.endsWith(path)) ??
      this.snapshot.pages.find((p) => p.path.split("/").pop() === r.split("/").pop())
    );
  }

  /** Integration pages: plugins and libraries. */
  integrations(): Array<{ name: string; kind: "plugin" | "library"; path: string; url: string }> {
    return this.snapshot.pages
      .filter((p) => /^\/(plugins|libraries)\/[^/]+$/.test(p.path))
      .map((p) => ({ name: p.title, kind: p.path.startsWith("/libraries/") ? ("library" as const) : ("plugin" as const), path: p.path, url: p.url }));
  }
}

function excerpt(text: string, terms: string[], max = 600): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 150, text.length - max));
  const cut = text.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + max < text.length ? "…" : ""}`;
}

export function pageText(p: DocPage, maxChars = 24_000): string {
  const body = [`# ${p.title}`, `Source: ${p.url}`, ...p.sections.filter((s) => !SKIP_HEADINGS.test(s.heading)).map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text))].join("\n\n");
  return body.length > maxChars ? `${body.slice(0, maxChars)}\n\n… (cut at ${maxChars} characters; the full page is at ${p.url})` : body;
}

export function loadSnapshot(): DocsSnapshot {
  return JSON.parse(readFileSync(new URL("./docs-snapshot.json", import.meta.url), "utf8")) as DocsSnapshot;
}
