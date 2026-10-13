import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackupManager, checkSnapshot, rehearseRestore } from '../server/backups.js';

const [command, snapshot, target] = process.argv.slice(2);
try {
  let result;
  if (command === 'create' && !snapshot) {
    const dataDirectory = process.env.DATA_DIR || fileURLToPath(new URL('../server/storage', import.meta.url));
    const backup = createBackupManager({ dataDirectory }).create();
    result = { verified: backup.verified, createdAt: backup.createdAt };
  } else if (command === 'check' && snapshot && !target) {
    const backup = checkSnapshot(path.resolve(snapshot));
    result = { verified: true, createdAt: backup.createdAt, users: backup.data.state.users.length, sessions: 0 };
  } else if (command === 'rehearse' && snapshot && target) {
    result = rehearseRestore(path.resolve(snapshot), path.resolve(target));
  } else throw new Error('USAGE');
  console.log(JSON.stringify(result));
} catch {
  console.error('Backup operation failed. Usage: node scripts/backup.mjs create | check <snapshot> | rehearse <snapshot> <new-directory>');
  process.exitCode = 1;
}
