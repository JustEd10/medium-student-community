import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium', 'firefox', 'webkit'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve('node_modules/.cache/ms-playwright') } });
process.exit(result.status ?? 1);
