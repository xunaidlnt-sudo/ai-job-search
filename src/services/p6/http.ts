// How Stratum talks HTTP to P6.
//
// - A connection can carry a company root certificate (PEM). It is trusted on
//   top of the built-in list, for P6 servers secured with an in-house CA.
// - The desktop app passes its own fetch (Electron's network stack), which
//   trusts the Windows/macOS certificate store and follows the system proxy.
// - On a server, HTTPS_PROXY / HTTP_PROXY / NO_PROXY are honoured.

import * as tls from "node:tls";
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import type { P6Connection } from "../../core/reporting";

export type FetchLike = typeof fetch;

/** Split a pasted bundle into individual PEM certificates (ignores anything else). */
export function parsePem(text: string | undefined): string[] {
  if (!text) return [];
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

export function caList(cfg: Pick<P6Connection, "caCert">): string[] | undefined {
  const extra = parsePem(cfg.caCert);
  return extra.length ? [...tls.rootCertificates, ...extra] : undefined;
}

const hasProxyEnv = () => !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);

function dispatcherFor(cfg: P6Connection): Dispatcher | null {
  const ca = caList(cfg);
  if (hasProxyEnv()) return new EnvHttpProxyAgent(ca ? { connect: { ca } } : {});
  if (ca) return new Agent({ connect: { ca } });
  return null;
}

/**
 * The fetch to use for one connection. A pasted company certificate wins (it
 * needs Node's TLS settings); otherwise the platform fetch, if one was given.
 */
export function p6Fetch(cfg: P6Connection, platformFetch?: FetchLike): FetchLike {
  if (parsePem(cfg.caCert).length || (!platformFetch && hasProxyEnv())) {
    const dispatcher = dispatcherFor(cfg);
    if (dispatcher) return ((url: string, init?: RequestInit) => undiciFetch(url, { ...(init as object), dispatcher } as never)) as unknown as FetchLike;
  }
  return platformFetch ?? fetch;
}

/** Plain-language reason for a failed request, from Node/undici/Chromium error text. */
export function describeNetError(e: unknown): { kind: "cert" | "dns" | "refused" | "timeout" | "other"; message: string } {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const text = `${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""} ${err?.message ?? ""}`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_CERT|certificate|altnames/i.test(text)) return { kind: "cert", message: text.trim() };
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/i.test(text)) return { kind: "dns", message: text.trim() };
  if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(text)) return { kind: "refused", message: text.trim() };
  if (/ETIMEDOUT|TIMED_OUT|UND_ERR_CONNECT_TIMEOUT|aborted/i.test(text)) return { kind: "timeout", message: text.trim() };
  return { kind: "other", message: text.trim() || String(e) };
}
