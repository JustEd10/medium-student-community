import fs from 'node:fs';
import path from 'node:path';
const directory = () => process.env.DATA_DIR || new URL('./storage/', import.meta.url).pathname;
export function createRegistrationMailer({ dataDirectory = directory(), env = process.env } = {}) {
  function config() {
    if (env.REGISTRATION_MAIL_MODE === 'local') {
      if (env.NODE_ENV === 'production' || env.HOST !== '127.0.0.1') return null;
      return { provider: 'local' };
    }
    try {
      const file = path.join(dataDirectory, 'email-config.json');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) return null;
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof c.from !== 'string' || /[\r\n]/.test(c.from)) return null;
      if (c.provider === 'resend' && typeof c.apiKey === 'string' && c.apiKey) return c;
      if (c.provider === 'smtp' && typeof c.host === 'string' && c.host && c.user && c.password &&
          ((c.port === 465 && c.secure === true) || (c.port === 587 && c.secure === false))) return c;
    } catch {}
    return null;
  }
  return {
    ready: () => Boolean(config()),
    async sendMail({ email, code }) {
      const c = config();
      if (!c) throw new Error('MAIL_NOT_CONFIGURED');
      const text = `Код подтверждения регистрации Медиум: ${code}. Действует 10 минут. Если вы не регистрировались, проигнорируйте письмо.`;
      if (c.provider === 'local') {
        fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
        const file = path.join(dataDirectory, 'mail-preview.json');
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, JSON.stringify({ email, code })); } finally { fs.closeSync(fd); }
        return { localPreview: true };
      }
      if (c.provider === 'resend') {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.from, to: [email], subject: 'Подтверждение регистрации Медиум', text }),
        });
        if (!response.ok) throw new Error('MAIL_DELIVERY_FAILED');
        return;
      }
      const { default: nodemailer } = await import('nodemailer');
      const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure,
        requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        auth: { user: c.user, pass: c.password }, connectionTimeout: 10000, socketTimeout: 10000,
        logger: false, debug: false });
      try { await transport.sendMail({ from: c.from, to: email, subject: 'Подтверждение регистрации Медиум', text }); }
      finally { transport.close(); }
    },
  };
}
