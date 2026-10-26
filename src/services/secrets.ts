// Passwords in settings (SMTP, P6) are never stored in plain text.
// The server encrypts with AES-256-GCM using STRATUM_SECRET; the desktop app
// uses the operating system keychain via Electron's safeStorage.

import crypto from "node:crypto";
import type { P6Connection, SmtpSettings } from "../core/reporting";
import type { Repository } from "./repo";

export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function aesBox(secret: string): SecretBox {
  if (!secret || secret.length < 16) throw new Error("STRATUM_SECRET must be at least 16 characters");
  const key = crypto.createHash("sha256").update(secret).digest();
  return {
    seal(plain) {
      if (!plain) return "";
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return `v1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64")}`;
    },
    open(sealed) {
      if (!sealed) return "";
      if (!sealed.startsWith("v1:")) return sealed; // legacy plain value
      const buf = Buffer.from(sealed.slice(3), "base64");
      const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

export const MASK = "••••••••";

export async function getSmtp(repo: Repository, box: SecretBox): Promise<SmtpSettings | null> {
  const s = await repo.getSetting<SmtpSettings>("smtp");
  return s ? { ...s, password: box.open(s.password) } : null;
}

/** Save SMTP settings. A masked password means "keep the stored one". */
export async function setSmtp(repo: Repository, box: SecretBox, s: SmtpSettings) {
  const old = await repo.getSetting<SmtpSettings>("smtp");
  const password = s.password === MASK ? old?.password ?? "" : box.seal(s.password);
  await repo.setSetting("smtp", { ...s, password });
}

export async function getP6Connections(repo: Repository, box: SecretBox): Promise<P6Connection[]> {
  const list = (await repo.getSetting<P6Connection[]>("p6")) ?? [];
  return list.map((c) => ({ ...c, password: c.password ? box.open(c.password) : "", token: c.token ? box.open(c.token) : "" }));
}

export async function setP6Connections(repo: Repository, box: SecretBox, list: P6Connection[]) {
  const old = new Map(((await repo.getSetting<P6Connection[]>("p6")) ?? []).map((c) => [c.id, c]));
  await repo.setSetting(
    "p6",
    list.map((c) => ({
      ...c,
      password: c.password === MASK ? old.get(c.id)?.password ?? "" : c.password ? box.seal(c.password) : "",
      token: c.token === MASK ? old.get(c.id)?.token ?? "" : c.token ? box.seal(c.token) : "",
    })),
  );
}

/** What the UI gets back: secrets replaced by a mask. */
export function maskSmtp(s: SmtpSettings | null): SmtpSettings | null {
  return s ? { ...s, password: s.password ? MASK : "" } : null;
}

export function maskP6(list: P6Connection[]): P6Connection[] {
  return list.map((c) => ({ ...c, password: c.password ? MASK : "", token: c.token ? MASK : "" }));
}
