// ─── Fetch resiliente para las APIs externas del tracker ─────────────────────
// Punto ÚNICO de salida a red: retry con backoff exponencial + jitter en
// 429/408/5xx y errores de red, y timeout por intento vía AbortController.
// Antes cada cliente (Jupiter/DexScreener/Helius) hacía `fetch` pelado: un 429
// o un blip de red transitorio abortaba el análisis entero (y, en el loop de
// discover, los tokens que faltaban).

export interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;            // timeout POR intento
  retries?: number;              // reintentos EXTRA (además del primero)
  retryOn?: (status: number) => boolean;
  label?: string;                // para mensajes de error claros
}

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryableStatus = (s: number) => s === 429 || s === 408 || (s >= 500 && s <= 599);

function backoffMs(attempt: number): number {
  const base = 250 * 2 ** attempt;             // 250, 500, 1000, …
  return base + Math.floor(Math.random() * (base / 2)); // + jitter
}

/**
 * `fetch` con timeout + retry/backoff. Devuelve la Response del último intento
 * (puede ser !ok si el status no es retryable o se agotaron los reintentos).
 * Lanza solo ante error de red persistente o timeout en todos los intentos.
 */
export async function fetchResilient(url: string, opts: FetchOpts = {}): Promise<Response> {
  const {
    method = "GET", headers, body,
    timeoutMs = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, retryOn = retryableStatus,
  } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok || !retryOn(res.status) || attempt === retries) return res;
      const ra = Number(res.headers.get("retry-after"));               // respeta Retry-After
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt));
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === retries) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr instanceof Error
    ? new Error(`${opts.label ?? "fetch"}: ${lastErr.message}`)
    : new Error(`${opts.label ?? "fetch"}: agotó reintentos`);
}

/** Igual que fetchResilient pero parsea JSON y lanza si el status final no es ok. */
export async function fetchJSON<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const label = opts.label ?? "fetch";
  const res = await fetchResilient(url, opts);
  if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/**
 * Retry/backoff genérico para operaciones que NO son fetch (ej. RPC de web3.js
 * `getSignaturesForAddress`, que también falla transitoriamente). Reintenta ante
 * cualquier throw hasta agotar `retries`.
 */
export async function retry<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES, label = "op"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr instanceof Error ? new Error(`${label}: ${lastErr.message}`) : new Error(`${label}: agotó reintentos`);
}
