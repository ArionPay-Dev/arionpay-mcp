/**
 * Settings, read from environment variables only. The API secret is never a tool argument, so it never passes
 * through the AI chat.
 */
export interface Config {
  /** Store API key (pk_…). Without key AND secret only the docs and public tools are offered. */
  apiKey?: string;
  /** Store API secret (sk_…). */
  apiSecret?: string;
  /** API base URL. */
  baseUrl: string;
  /** Real (non-test) invoices allowed. Off by default: every invoice is a test invoice. */
  live: boolean;
  /** Largest amount of a real invoice, in the invoice's own currency. */
  maxAmount: number;
  /** Only reading tools: no invoice is created, simulated or webhook sent. */
  readOnly: boolean;
}

export const DEFAULT_BASE_URL = "https://merchant.arionpay.com";
export const DEFAULT_MAX_AMOUNT = 1000;

const yes = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.ARIONPAY_API_KEY?.trim() || undefined;
  const apiSecret = env.ARIONPAY_API_SECRET?.trim() || undefined;
  if (apiKey && !/^pk_[A-Za-z0-9_-]{8,64}$/.test(apiKey)) throw new Error("ARIONPAY_API_KEY must be your store's API key (it starts with pk_).");
  if (apiKey && !apiSecret) throw new Error("ARIONPAY_API_SECRET is missing. Set both ARIONPAY_API_KEY and ARIONPAY_API_SECRET, or neither.");
  if (apiSecret && !apiKey) throw new Error("ARIONPAY_API_KEY is missing. Set both ARIONPAY_API_KEY and ARIONPAY_API_SECRET, or neither.");
  const baseUrl = (env.ARIONPAY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
    throw new Error("ARIONPAY_BASE_URL must be an https:// address (http:// only for localhost).");
  }
  const rawMax = env.ARIONPAY_MAX_AMOUNT?.trim();
  const maxAmount = rawMax ? Number(rawMax) : DEFAULT_MAX_AMOUNT;
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) throw new Error("ARIONPAY_MAX_AMOUNT must be a number above 0.");
  return { apiKey, apiSecret, baseUrl, live: yes(env.ARIONPAY_LIVE), maxAmount, readOnly: yes(env.ARIONPAY_READ_ONLY) };
}
