import path from 'node:path';
import { createDriveBackupUploader } from '../server/drive-backups.js';

const [command, source, target] = process.argv.slice(2);
try {
  if (!process.env.DATA_DIR || !source || !['upload', 'verify'].includes(command) || (command === 'verify' && !target)) throw new Error();
  const uploader = createDriveBackupUploader({ dataDirectory: path.resolve(process.env.DATA_DIR), configFile: process.env.DRIVE_BACKUP_CONFIG || undefined });
  if (command === 'upload') {
    if (!await uploader.enqueueSnapshot(path.resolve(source))) throw new Error();
    console.log(JSON.stringify({ verified: true, ...uploader.getStatus() }));
  } else {
    console.log(JSON.stringify(await uploader.verifyRestore(source, path.resolve(target))));
  }
} catch {
  console.error('DRIVE_BACKUP_UNAVAILABLE');
  process.exitCode = 1;
}
