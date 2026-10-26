// One entry point for both P6 connection types.

import type { P6Connection } from "../../core/reporting";
import type { Schedule } from "../../core/types";
import { EppmClient, eppmImport, eppmListProjects, eppmPushProgress, type PushResult } from "./eppm";
import { openP6Db, p6DbImport, p6DbListProjects } from "./db";

export interface P6ProjectInfo {
  objectId: string;
  code: string;
  name: string;
  dataDate: string;
}

export async function p6Test(cfg: P6Connection, opts: { wasmDir?: string } = {}): Promise<string> {
  const list = await p6ListProjects(cfg, opts);
  return `Connected. ${list.length} project(s) visible.`;
}

export async function p6ListProjects(cfg: P6Connection, opts: { wasmDir?: string } = {}): Promise<P6ProjectInfo[]> {
  if (cfg.kind === "eppm") {
    const c = new EppmClient(cfg);
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

export async function p6Import(cfg: P6Connection, projectObjectId: string, opts: { wasmDir?: string } = {}): Promise<Schedule> {
  return cfg.kind === "eppm" ? eppmImport(cfg, projectObjectId) : p6DbImport(cfg, projectObjectId, opts);
}

export async function p6Push(cfg: P6Connection, schedule: Schedule): Promise<PushResult> {
  if (cfg.kind !== "eppm") {
    throw new Error("P6 Professional databases are read-only in Stratum. Export an XER (Export → P6 XER) and import it in P6 to update the project.");
  }
  return eppmPushProgress(cfg, schedule);
}
