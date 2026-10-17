import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createSeed } from '../src/data.js';

test('migration CLI preserves legacy bytes and never reimports an existing database',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medium-migrate-cli-'));
  try {
    const file=path.join(dir,'db.json'),source=JSON.stringify({state:createSeed(),sessions:{}},null,2);
    fs.writeFileSync(file,source);
    const run=()=>spawnSync(process.execPath,['scripts/migrate-database.mjs',dir],{encoding:'utf8',timeout:5000});
    const first=run();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).alreadyMigrated,false);
    assert.equal(fs.readFileSync(file,'utf8'),source);
    const second=run();assert.equal(second.status,0,second.stderr);assert.equal(JSON.parse(second.stdout).alreadyMigrated,true);
    assert.equal(fs.readFileSync(file,'utf8'),source);
    const sql=new DatabaseSync(path.join(dir,'medium.sqlite'));
    assert.equal(sql.prepare('SELECT count(*) AS n FROM users').get().n,createSeed().users.length);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM lesson_items').get().n,3);sql.close();
    assert.ok(!first.stdout.includes(dir));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('standalone SQL CRUD exercise creates, inserts, selects, updates and deletes in a disposable database',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec(fs.readFileSync(new URL('../docs/database/01-crud.sql',import.meta.url),'utf8'));
    assert.equal(sql.prepare('SELECT count(*) AS n FROM students').get().n,0);
    assert.equal(sql.prepare("SELECT type FROM sqlite_master WHERE name='students'").get().type,'table');
  } finally {sql.close();}
});
