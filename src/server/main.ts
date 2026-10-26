// Stratum Server entry point. Configure with environment variables:
//
//   DATABASE_URL     postgres://user:pass@host:5432/stratum   (or STRATUM_DB_FILE for SQLite)
//   STRATUM_SECRET   long random string: signs sessions and encrypts stored passwords
//   PORT             default 8080
//   PUBLIC_URL       how the server reaches its own web app for PDF rendering (default http://127.0.0.1:PORT)
//   STATIC_DIR       built web app (default ./dist)
//   STRATUM_PDF      "off" to disable PDF rendering (Excel is still sent)

import path from "node:path";
import { StratumApi } from "../services/api";
import { Repository } from "../services/repo";
import { startScheduler } from "../services/runner";
import { aesBox } from "../services/secrets";
import { openPostgres, openSqlite } from "../services/sql";
import { buildServer } from "./app";
import { playwrightRenderer } from "./pdf";

async function main() {
  const secret = process.env.STRATUM_SECRET ?? "";
  if (secret.length < 16) throw new Error("Set STRATUM_SECRET to a random string of at least 16 characters.");
  const port = Number(process.env.PORT ?? 8080);
  const publicUrl = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  const staticDir = process.env.STATIC_DIR ?? path.resolve(process.cwd(), "dist");
  // The bundled server ships sql-wasm.wasm next to itself.
  const wasmDir = process.env.SQLJS_WASM_DIR ?? (typeof __dirname !== "undefined" ? __dirname : undefined);

  const driver = process.env.DATABASE_URL
    ? await openPostgres(process.env.DATABASE_URL)
    : await openSqlite(process.env.STRATUM_DB_FILE ?? path.resolve("stratum-server.db"), { wasmDir });
  const repo = new Repository(driver);
  await repo.migrate();

  let renderPdf: ((d: string, p: string | null) => Promise<Buffer>) | null = null;
  let tokenSource: (() => string) | null = null;
  if (process.env.STRATUM_PDF !== "off") {
    renderPdf = await playwrightRenderer(publicUrl, () => tokenSource!());
    if (!renderPdf) console.warn("[stratum] Playwright/Chromium not available: reports will attach Excel only.");
  }
  const api = new StratumApi({ repo, box: aesBox(secret), renderPdf, wasmDir, log: (m) => console.log(m), where: "server" });
  const { app, internalRenderToken } = await buildServer({ repo, api, jwtSecret: secret, staticDir, log: true });
  tokenSource = internalRenderToken;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[stratum] server on ${publicUrl} using ${repo.dialect}`);
  startScheduler(api.runnerDeps());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
