import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || resolve('node_modules/.cache/ms-playwright') };
// Existing CI installs Chromium and Firefox; add Safari's engine before testing.
if (process.env.CI) {
  const install = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', '--with-deps', 'webkit'], { stdio: 'inherit', env });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
