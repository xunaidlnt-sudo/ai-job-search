// Minimal SQL driver interface with two implementations:
//   - SQLite via sql.js (WebAssembly, no native build) for the desktop app's
//     local database file;
//   - PostgreSQL via pg for the shared server.
// Queries are written with "?" placeholders; the Postgres driver rewrites
// them to $1, $2…

import fs from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;

export interface SqlDriver {
  dialect: "sqlite" | "postgres";
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- SQLite

type SqlJs = typeof import("sql.js");

let sqlJsPromise: Promise<Awaited<ReturnType<SqlJs["default"]>>> | null = null;

export async function loadSqlJs(wasmDir?: string) {
  if (!sqlJsPromise) {
    const init = (await import("sql.js")).default;
    sqlJsPromise = init(wasmDir ? { locateFile: (f: string) => path.join(wasmDir, f) } : undefined);
  }
  return sqlJsPromise;
}

/**
 * SQLite database backed by a file. sql.js keeps the database in memory, so
 * every write is flushed to disk (atomically, via a temp file and rename).
 */
export async function openSqlite(file: string | null, opts: { wasmDir?: string; readOnly?: boolean } = {}): Promise<SqlDriver> {
  const SQL = await loadSqlJs(opts.wasmDir);
  const db = file && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  const flush = () => {
    if (!file || opts.readOnly) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, file);
  };
  const run = <T>(sql: string, params: unknown[] = []): T[] => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as never);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };
  return {
    dialect: "sqlite",
    async query<T>(sql: string, params?: unknown[]) {
      return run<T>(sql, params);
    },
    async exec(sql: string, params?: unknown[]) {
      if (opts.readOnly) throw new Error("Database is open read-only");
      if (params?.length) run(sql, params);
      else db.exec(sql);
      flush();
    },
    async close() {
      db.close();
    },
  };
}

// ------------------------------------------------------------- PostgreSQL

const toDollar = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

export async function openPostgres(connectionString: string): Promise<SqlDriver> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 10 });
  await pool.query("select 1");
  return {
    dialect: "postgres",
    async query<T>(sql: string, params?: unknown[]) {
      const r = await pool.query(toDollar(sql), params as unknown[]);
      return r.rows as T[];
    },
    async exec(sql: string, params?: unknown[]) {
      await pool.query(toDollar(sql), params as unknown[]);
    },
    async close() {
      await pool.end();
    },
  };
}
