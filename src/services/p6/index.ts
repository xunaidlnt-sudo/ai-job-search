// One entry point for both P6 connection types.

import type { P6Connection } from "../../core/reporting";
import type { Schedule } from "../../core/types";
import { EppmClient, eppmImport, eppmListProjects, eppmPushProgress, type PushResult } from "./eppm";
import { openP6Db, p6DbImport, p6DbListProjects } from "./db";
import { p6Fetch, parsePem, type FetchLike } from "./http";

/**
 * Options shared by every P6 call. `fetch` is the platform fetch (the desktop
 * app passes Electron's, which trusts the OS certificate store and proxy and
 * keeps cookies itself).
 */
export interface P6Opts {
  wasmDir?: string;
  fetch?: FetchLike;
  /** The platform fetch keeps its own cookie jar. */
  cookieJar?: boolean;
}

/** The fetch and client options to use for this connection. */
export function eppmTransport(cfg: P6Connection, opts: P6Opts): { fetch: FetchLike; cookieJar: boolean } {
  const usesPlatform = !!opts.fetch && !parsePem(cfg.caCert).length;
  return { fetch: p6Fetch(cfg, opts.fetch), cookieJar: usesPlatform && !!opts.cookieJar };
}

export interface P6ProjectInfo {
  objectId: string;
  code: string;
  name: string;
  dataDate: string;
}

export async function p6Test(cfg: P6Connection, opts: P6Opts = {}): Promise<string> {
  const list = await p6ListProjects(cfg, opts);
  return `Connected. ${list.length} project(s) visible.`;
}

export async function p6ListProjects(cfg: P6Connection, opts: P6Opts = {}): Promise<P6ProjectInfo[]> {
  if (cfg.kind === "eppm") {
    const t = eppmTransport(cfg, opts);
    const c = new EppmClient(cfg, t.fetch, { cookieJar: t.cookieJar });
    await c.login();
    try {
      return await eppmListProjects(c);
    } finally {
      await c.logout();
    }
  }
  const db = await openP6Db(cfg, opts);
  try {
    return await p6DbListProjects(db);
  } finally {
    await db.close();
  }
}

export async function p6Import(cfg: P6Connection, projectObjectId: string, opts: P6Opts = {}): Promise<Schedule> {
  if (cfg.kind !== "eppm") return p6DbImport(cfg, projectObjectId, opts);
  const t = eppmTransport(cfg, opts);
  return eppmImport(cfg, projectObjectId, t.fetch, { cookieJar: t.cookieJar });
}

export async function p6Push(cfg: P6Connection, schedule: Schedule, opts: P6Opts = {}): Promise<PushResult> {
  if (cfg.kind !== "eppm") {
    throw new Error("P6 Professional databases are read-only in Stratum. Export an XER (Export → P6 XER) and import it in P6 to update the project.");
  }
  const t = eppmTransport(cfg, opts);
  return eppmPushProgress(cfg, schedule, t.fetch, { cookieJar: t.cookieJar });
}
