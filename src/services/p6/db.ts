// P6 Professional database connector (read-only).
//
// P6's project database uses the same tables an XER file contains (an XER is
// an export of them), so this reads the tables for one project and hands them
// to the normal XER importer.
//
// Supported: SQL Server and Oracle (P6 Professional connected to a
// company database) and SQLite (P6 Professional standalone).
//
// Read-only on purpose: Oracle does not support writing to the P6 database
// directly; P6's own business logic (scheduling, summaries, audit) would be
// bypassed. Changes go back to P6 through an XER import or the EPPM API.

import type { P6Connection } from "../../core/reporting";
import type { Schedule } from "../../core/types";
import { xerToSchedule, type XerTables } from "../../core/xer";
import type * as OracleTypes from "oracledb";
import { openSqlite } from "../sql";

type Row = Record<string, unknown>;

export interface P6Db {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
  /** Quoted table name with the configured schema/owner. */
  table(name: string): string;
}

/** Tables read for one project, and whether each is filtered by proj_id. */
const TABLES: [string, boolean][] = [
  ["PROJECT", true],
  ["PROJWBS", true],
  ["TASK", true],
  ["TASKPRED", true],
  ["CALENDAR", false],
  ["RSRC", false],
  ["RSRCRATE", false],
  ["UMEASURE", false],
  ["TASKRSRC", true],
  ["ACTVTYPE", false],
  ["ACTVCODE", false],
  ["TASKACTV", true],
  ["UDFTYPE", false],
  ["UDFVALUE", true],
];

const safeIdent = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(s)) throw new Error(`Invalid schema name: ${s}`);
  return s;
};

export async function openP6Db(cfg: P6Connection, opts: { wasmDir?: string } = {}): Promise<P6Db> {
  const schema = cfg.schema ? safeIdent(cfg.schema) : "";
  const table = (n: string) => (schema ? `${schema}.${n}` : n);

  if (cfg.kind === "p6-sqlite") {
    if (!cfg.file) throw new Error("Path to the P6 Professional SQLite database (.db) is required");
    const db = await openSqlite(cfg.file, { wasmDir: opts.wasmDir, readOnly: true });
    return { query: (sql, p) => db.query(sql, p), close: () => db.close(), table: (n) => n };
  }

  if (cfg.kind === "p6-sqlserver") {
    const mssql = (await import("mssql")).default;
    const pool = await new mssql.ConnectionPool({
      server: cfg.host ?? "localhost",
      port: cfg.port ?? 1433,
      database: cfg.service,
      user: cfg.user,
      password: cfg.password,
      options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
      requestTimeout: 120_000,
    }).connect();
    return {
      table,
      async query(sql, params = []) {
        let i = 0;
        const req = pool.request();
        params.forEach((p, k) => req.input(`p${k}`, p as never));
        const r = await req.query(sql.replace(/\?/g, () => `@p${i++}`));
        return r.recordset as Row[];
      },
      close: () => pool.close(),
    };
  }

  if (cfg.kind === "p6-oracle") {
    const oracledb = (await import("oracledb")).default;
    const conn = await oracledb.getConnection({
      user: cfg.user,
      password: cfg.password,
      connectString: `${cfg.host ?? "localhost"}:${cfg.port ?? 1521}/${cfg.service ?? ""}`,
    });
    return {
      table,
      async query(sql, params = []) {
        let i = 0;
        const r = await conn.execute(sql.replace(/\?/g, () => `:${++i}`), params as OracleTypes.BindParameters, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          // P6 keeps calendar data in a LOB: read it as text/bytes, not a stream.
          fetchTypeHandler: (meta: OracleTypes.Metadata<unknown>) =>
            meta.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : meta.dbType === oracledb.DB_TYPE_BLOB ? { type: oracledb.BUFFER } : undefined,
        });
        // Oracle returns upper-case column names.
        return ((r.rows ?? []) as Row[]).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])));
      },
      close: () => conn.close(),
    };
  }

  throw new Error(`Not a P6 database connection: ${cfg.kind}`);
}

/** DB values to XER text: dates as "YYYY-MM-DD HH:MM", blobs as text, nulls as "". */
export function toXerValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  }
  if (v instanceof Uint8Array) return Buffer.from(v).toString("latin1");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return v.replace("T", " ").slice(0, 16);
  return String(v);
}

function normalise(rows: Row[]): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), toXerValue(v)])));
}

/** Rows not soft-deleted by P6 (delete_session_id set). Falls back when the column does not exist. */
async function selectLive(db: P6Db, name: string, where: string, params: unknown[]): Promise<Row[]> {
  const base = `select * from ${db.table(name)}${where ? ` where ${where}` : ""}`;
  try {
    return await db.query(`${base}${where ? " and" : " where"} delete_session_id is null`, params);
  } catch {
    try {
      return await db.query(base, params);
    } catch (err) {
      // Optional tables (UDFs, rates…) may not exist in every database.
      if (["PROJECT", "PROJWBS", "TASK", "TASKPRED"].includes(name)) throw err;
      return [];
    }
  }
}

export async function p6DbListProjects(db: P6Db): Promise<{ objectId: string; code: string; name: string; dataDate: string }[]> {
  const projects = normalise(await selectLive(db, "PROJECT", "orig_proj_id is null", []).catch(() => selectLive(db, "PROJECT", "", [])));
  const roots = normalise(await selectLive(db, "PROJWBS", "proj_node_flag = ?", ["Y"]));
  const nameOf = new Map(roots.map((r) => [r.proj_id, r.wbs_name]));
  return projects
    .map((p) => ({ objectId: p.proj_id, code: p.proj_short_name, name: nameOf.get(p.proj_id) ?? p.proj_short_name, dataDate: p.last_recalc_date ?? "" }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function p6DbPullTables(db: P6Db, projId: string): Promise<XerTables> {
  const out: XerTables = {};
  for (const [name, byProject] of TABLES) {
    out[name] = normalise(await selectLive(db, name, byProject ? "proj_id = ?" : "", byProject ? [projId] : []));
  }
  if (!out.PROJECT.length) throw new Error(`Project ${projId} not found in the P6 database`);
  return out;
}

export async function p6DbImport(cfg: P6Connection, projectObjectId: string, opts: { wasmDir?: string } = {}): Promise<Schedule> {
  const db = await openP6Db(cfg, opts);
  try {
    const tables = await p6DbPullTables(db, projectObjectId);
    return {
      ...xerToSchedule(tables, { projectId: projectObjectId }),
      sourceFormat: "p6-db",
      p6Source: { connectionId: cfg.id, projectObjectId, kind: cfg.kind, pulledAt: new Date().toISOString() },
    };
  } finally {
    await db.close();
  }
}
