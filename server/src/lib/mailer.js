import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 'smtp' when SMTP_HOST is configured, otherwise 'preview' (nothing leaves the server; emails are written to a folder). */
export const mailMode = () => (process.env.SMTP_HOST ? 'smtp' : 'preview');
export const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
const from = () => process.env.MAIL_FROM || 'Penny <no-reply@localhost>';
const previewDir = () => process.env.MAIL_PREVIEW_DIR || path.join(here, '../../mail-preview');

let transport;
let transportKey;
function getTransport() {
  const key = [process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER, process.env.SMTP_SECURE].join('|');
  if (!transport || transportKey !== key) {
    transportKey = key;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      ignoreTLS: process.env.SMTP_IGNORE_TLS === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

/** Send (or, in preview mode, save) one e-mail. Throws if the SMTP server refuses it. */
export async function sendMail({ to, subject, text, html, headers = {} }) {
  if (mailMode() === 'smtp') {
    await getTransport().sendMail({ from: from(), to, subject, text, html, headers });
    return { status: 'sent' };
  }
  const dir = previewDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const file = path.join(dir, `${base}.html`);
  const meta = `<!-- To: ${to}\n     Subject: ${subject.replace(/--/g, '- -')}\n     (preview mode: this e-mail was not sent; set SMTP_HOST to send for real) -->\n`;
  fs.writeFileSync(file, meta + html);
  fs.writeFileSync(path.join(dir, `${base}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  return { status: 'preview', file };
}
