// Run on the owner's computer, not on the public application server.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scope = 'https://www.googleapis.com/auth/drive.file';
const repository = fileURLToPath(new URL('../', import.meta.url));
export function readDesktopClient(file) {
  const client = JSON.parse(fs.readFileSync(file, 'utf8')).installed;
  if (!client || typeof client.client_id !== 'string' || !client.client_id.endsWith('.apps.googleusercontent.com') || typeof client.client_secret !== 'string' || !client.client_secret) throw new Error('DESKTOP_CLIENT_REQUIRED');
  return client;
}
export function authorizationParameters(clientId, redirectUri, state, verifier) {
  return new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state,
    code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
}
function privateTarget(file) {
  const result = path.resolve(file);
  const relative = path.relative(repository, result);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && !relative.startsWith('server' + path.sep + 'storage' + path.sep)) throw new Error('PRIVATE_DESTINATION_REQUIRED');
  if (fs.existsSync(result)) throw new Error('DESTINATION_EXISTS');
  fs.mkdirSync(path.dirname(result), { recursive: true, mode: 0o700 });
  // Check real parent as well so a symlink cannot redirect credentials into the source tree.
  const realRelative = path.relative(fs.realpathSync(repository), fs.realpathSync(path.dirname(result)));
  if (!realRelative.startsWith('..' + path.sep) && !path.isAbsolute(realRelative) && !realRelative.startsWith('server' + path.sep + 'storage')) throw new Error('PRIVATE_DESTINATION_REQUIRED');
  return result;
}
async function googleJson(url, options, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('GOOGLE_AUTHORIZATION_FAILED');
  return response.json();
}
export async function connectDrive({ clientFile, configFile, recoveryKeyFile, fetchImpl = globalThis.fetch, onReady = url => console.log(`Для подключения открой в браузере: ${url}`), timeoutMs = 10 * 60 * 1000 }) {
  const client = readDesktopClient(clientFile);
  const configPath = privateTarget(configFile);
  const keyPath = privateTarget(recoveryKeyFile);
  if (configPath === keyPath) throw new Error('SEPARATE_KEY_COPY_REQUIRED');
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  let settled = false;
  let exchanging = false;
  let timer;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const address = server.address();
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${address.port}`) { res.writeHead(400); res.end('Invalid request'); return; }
    const url = new URL(req.url, `http://127.0.0.1:${address.port}`);
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    if (url.pathname === '/connect' && !settled) {
      res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${authorizationParameters(client.client_id, redirectUri, state, verifier)}` }); res.end(); return;
    }
    if (url.pathname !== '/callback' || settled || exchanging) { res.writeHead(404); res.end('Not found'); return; }
    const suppliedState = url.searchParams.get('state') || '';
    if (Buffer.byteLength(suppliedState) !== Buffer.byteLength(state) || !crypto.timingSafeEqual(Buffer.from(suppliedState), Buffer.from(state))) { res.writeHead(400); res.end('Invalid state'); return; }
    if (url.searchParams.has('error') || !url.searchParams.get('code')) { settled = true; res.writeHead(400); res.end('Авторизация не завершена. Данные аккаунта не сохранены.', () => rejectDone(new Error('GOOGLE_AUTHORIZATION_FAILED'))); return; }
    exchanging = true;
    try {
      const tokens = await googleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, code: url.searchParams.get('code'), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) }, fetchImpl);
      if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.scope?.trim() !== scope) throw new Error('GOOGLE_AUTHORIZATION_FAILED');
      if (settled) throw new Error('AUTHORIZATION_TIMEOUT');
      const headers = { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' };
      const folder = await googleJson('https://www.googleapis.com/drive/v3/files?fields=id,mimeType,ownedByMe', { method: 'POST', headers, body: JSON.stringify({ name: 'Медиум — резервные копии', mimeType: 'application/vnd.google-apps.folder' }) }, fetchImpl);
      if (!/^[A-Za-z0-9_-]+$/.test(folder.id) || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.ownedByMe !== true) throw new Error('PRIVATE_FOLDER_REQUIRED');
      const permissions = await googleJson(`https://www.googleapis.com/drive/v3/files/${folder.id}/permissions?fields=permissions(role,type),nextPageToken`, { headers }, fetchImpl);
      if (permissions.nextPageToken || !permissions.permissions?.length || !permissions.permissions.every(p => p.role === 'owner' && p.type === 'user')) throw new Error('PRIVATE_FOLDER_REQUIRED');
      if (settled) throw new Error('AUTHORIZATION_TIMEOUT');
      const encryptionKey = crypto.randomBytes(32).toString('base64');
      // The recovery copy never goes to Drive. Preserve it separately from the hosting disk.
      fs.writeFileSync(keyPath, JSON.stringify({ format: 1, encryptionKey }), { flag: 'wx', mode: 0o600, flush: true });
      fs.writeFileSync(configPath, JSON.stringify({ enabled: true, clientId: client.client_id, clientSecret: client.client_secret, refreshToken: tokens.refresh_token, folderId: folder.id, encryptionKey }), { flag: 'wx', mode: 0o600, flush: true });
      settled = true;
      res.end('Подключение подготовлено. Закрытая конфигурация и ключ восстановления сохранены на этом компьютере. Загрузка на сервер ещё не выполнена.', () => resolveDone({ connected: true }));
    } catch {
      settled = true; res.writeHead(400); res.end('Не удалось завершить подключение. Содержимое ошибки и токены не выводятся.', () => rejectDone(new Error('GOOGLE_AUTHORIZATION_FAILED')));
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    onReady(`http://127.0.0.1:${server.address().port}/connect`);
    timer = setTimeout(() => { settled = true; rejectDone(new Error('AUTHORIZATION_TIMEOUT')); }, timeoutMs);
    return await done;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 3) throw new Error('USAGE');
    await connectDrive({ clientFile: args[0], configFile: args[1], recoveryKeyFile: args[2] });
    console.log('Подключение подготовлено. Секреты не выводятся.');
  } catch { console.error('Подключение не завершено. Нужны файл OAuth-клиента типа Desktop и два новых приватных пути для конфигурации и ключа восстановления.'); process.exitCode = 1; }
}
