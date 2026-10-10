import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inStore(dir, code) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8', timeout: 5000,
  });
}

test('state survives a new process; expired and legacy sessions do not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-store-'));
  try {
    const created = inStore(dir, `
      import { db, commit } from './server/store.js';
      const state = structuredClone(db.state);
      state.users.find(u => u.id === 'alina').about = 'Сохранённый профиль';
      commit({ state, sessions: {
        ['a'.repeat(48)]: { userId: 'alina', expiresAt: Date.now() + 60000 },
        ['b'.repeat(48)]: { userId: 'alina', expiresAt: 1 },
        ['c'.repeat(48)]: 'alina',
        ['d'.repeat(48)]: { userId: 'unknown', expiresAt: Date.now() + 60000 },
      }});
    `);
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(readdirSync(dir), ['db.json']);
    const reopened = inStore(dir, `
      import { db } from './server/store.js';
      console.log(JSON.stringify({ about: db.state.users.find(u => u.id === 'alina').about, tokens: Object.keys(db.sessions) }));
    `);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), { about: 'Сохранённый профиль', tokens: ['a'.repeat(48)] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt saved data stops startup and is never replaced with demo data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-corrupt-'));
  try {
    for (const contents of ['{broken JSON', JSON.stringify({ state: { users: [] }, sessions: {} })]) {
      writeFileSync(join(dir, 'db.json'), contents);
      const result = inStore(dir, "import './server/store.js';");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Не удалось прочитать базу/);
      assert.equal(readFileSync(join(dir, 'db.json'), 'utf8'), contents);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
