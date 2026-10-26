// Sending report emails over SMTP (Office 365, Gmail, company servers).

import type { SmtpSettings } from "../core/reporting";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  verify(): Promise<void>;
  send(m: MailMessage): Promise<{ messageId: string; accepted: string[] }>;
}

export async function smtpMailer(s: SmtpSettings): Promise<Mailer> {
  if (!s.host) throw new Error("SMTP server is not configured (Settings → Email).");
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    // Office 365 and most company servers require STARTTLS on 587.
    requireTLS: !s.secure && s.port === 587,
    connectionTimeout: 20_000,
  });
  return {
    async verify() {
      await transport.verify();
    },
    async send(m) {
      const info = await transport.sendMail({
        from: s.from || s.user,
        to: m.to.join(", "),
        cc: m.cc?.length ? m.cc.join(", ") : undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { messageId: info.messageId, accepted: (info.accepted as string[]).map(String) };
    },
  };
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function parseRecipients(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return { valid: parts.filter(isEmail), invalid: parts.filter((x) => !isEmail(x)) };
}
