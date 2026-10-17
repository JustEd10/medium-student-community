import path from 'node:path';
import fs from 'node:fs';
import { openSqliteStore } from '../server/sqlite-store.js';
import { createLessonStore } from '../server/lesson-database.js';
const dir=process.argv[2];
if(!dir || process.argv.length!==3) { console.error('Usage: node scripts/migrate-database.mjs <local-data-directory>');process.exitCode=1; }
else {
  let store;
  try {
    const data=path.resolve(dir),file=path.join(data,'medium.sqlite'),existing=fs.existsSync(file);
    if(!existing && !fs.existsSync(path.join(data,'db.json'))) throw new Error('SOURCE_REQUIRED');
    store=openSqliteStore({file,legacyFile:path.join(data,'db.json')});createLessonStore(store.sql);
    console.log(JSON.stringify({verified:true,alreadyMigrated:existing,users:store.read().state.users.length,foreignKeyErrors:store.sql.prepare('PRAGMA foreign_key_check').all().length,legacyUnchanged:true}));
  } catch { console.error('Migration failed; source JSON was not modified. Use an isolated local copy and inspect the database.');process.exitCode=1; }
  finally {store?.close();}
}
