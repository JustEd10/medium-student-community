import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || resolve('node_modules/.cache/ms-playwright') };
// Existing CI installs Chromium and Firefox; add Safari's engine before testing.
if (process.env.CI) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    // The runner's Azure mirror can stall on WebKit packages. Keep the same
    // signed Ubuntu repositories and use Canonical's main archive over HTTPS.
    const mirror = spawnSync('sudo', ['python3', '-c', `
from pathlib import Path
for source in Path('/etc/apt').rglob('*'):
    if source.is_file() and (source.name == 'sources.list' or source.suffix in ['.sources', '.list']):
        text = source.read_text()
        updated = text.replace('http://azure.archive.ubuntu.com/ubuntu', 'https://archive.ubuntu.com/ubuntu')
        if updated != text:
            source.write_text(updated)
`], { stdio: 'inherit', env });
    if (mirror.status !== 0) process.exit(mirror.status ?? 1);
  }
  const install = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', '--with-deps', 'webkit'], { stdio: 'inherit', env });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
