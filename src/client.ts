/**
 * A small signed client for the ArionPay shop API.
 *
 *   x-api-key    store API key (pk_…)
 *   x-timestamp  unix seconds
 *   x-signature  hex HMAC-SHA256(secret, `${timestamp}.${body}`)              POST
 *                hex HMAC-SHA256(secret, `${timestamp}.GET ${path?query}`)     GET
 *
 * The server refuses an identical signed request twice (replay guard). Every signed GET therefore carries a random
 * `nonce` query value, and a POST refused as "already used" is signed again one second later.
 */
import { createHmac, randomBytes } from "node:crypto";

export class ArionPayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ArionPayApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  /** For tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ArionPayClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  get hasKeys(): boolean {
    return Boolean(this.opts.apiKey && this.opts.apiSecret);
  }

  /** Public endpoint, no signature. */
  async publicGet<T>(path: string): Promise<T> {
    return this.send<T>("GET", path, undefined, {});
  }

  /** Signed GET: `query` values that are undefined are left out. */
  async signedGet<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
    params.set("nonce", randomBytes(8).toString("hex"));
    const pathWithQuery = `${path}?${params.toString()}`;
    return this.withReplayRetry(() => {
      const ts = Math.floor(Date.now() / 1000);
      return this.send<T>("GET", pathWithQuery, undefined, this.headers(ts, `${ts}.GET ${pathWithQuery}`));
    });
  }

  /** Signed POST of a JSON body (the exact bytes sent are the bytes signed). */
  async signedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const raw = JSON.stringify(body);
    return this.withReplayRetry(() => {
      const ts = Math.floor(Date.now() / 1000);
      return this.send<T>("POST", path, raw, this.headers(ts, `${ts}.${raw}`));
    });
  }

  private headers(ts: number, toSign: string): Record<string, string> {
    if (!this.opts.apiKey || !this.opts.apiSecret) throw new ArionPayApiError("This needs your store API key and secret (ARIONPAY_API_KEY and ARIONPAY_API_SECRET).", 0, "no_keys");
    return {
      "x-api-key": this.opts.apiKey,
      "x-timestamp": String(ts),
      "x-signature": createHmac("sha256", this.opts.apiSecret).update(toSign).digest("hex"),
    };
  }

  /** The same request signed again (new timestamp) once, when the server says the signature was already used. */
  private async withReplayRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof ArionPayApiError && e.status === 401 && /already used/i.test(e.message)) {
        await sleep(1100);
        return run();
      }
      throw e;
    }
  }

  private async send<T>(method: "GET" | "POST", path: string, raw: string | undefined, headers: Record<string, string>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method,
        headers: { accept: "application/json", "user-agent": this.opts.userAgent ?? "arionpay-mcp", ...(raw !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: raw,
        signal: ctrl.signal,
      });
    } catch (e) {
      const why = (e as Error).name === "AbortError" ? `no answer within ${Math.round(this.timeoutMs / 1000)} s` : (e as Error).message;
      throw new ArionPayApiError(`Could not reach ArionPay (${why}).`, 0, "network");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON (e.g. a proxy error page)
    }
    if (!res.ok) {
      const d = (data ?? {}) as { error?: unknown; message?: unknown; code?: unknown };
      const msg = typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : `HTTP ${res.status}`;
      throw new ArionPayApiError(msg, res.status, typeof d.code === "string" ? d.code : undefined);
    }
    if (data === undefined) throw new ArionPayApiError(`ArionPay answered with something that is not JSON (HTTP ${res.status}).`, res.status, "bad_response");
    return data as T;
  }
}
