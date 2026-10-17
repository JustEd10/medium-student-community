import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { benchmarkIndex } from './database-benchmark.mjs';
const output=path.resolve(process.argv[2] || 'test-results/database');
fs.mkdirSync(output,{recursive:true});
const exercise = new DatabaseSync(':memory:');
try {
  exercise.exec(fs.readFileSync(new URL('../docs/database/01-crud.sql',import.meta.url),'utf8'));
  assert.equal(exercise.prepare('SELECT count(*) AS n FROM students').get().n,0);
} finally {exercise.close();}
const evidence=path.join(output,'api-evidence.json');
const result=spawnSync(process.execPath,['--test','tests/database-integration.test.js'],{
  env:{...process.env,DATABASE_EVIDENCE_FILE:evidence},encoding:'utf8',timeout:30000,
});
fs.writeFileSync(path.join(output,'integration-test.txt'),result.stdout+result.stderr);
if(result.status!==0) { console.error(result.stdout+result.stderr);process.exit(1); }
const benchmark=benchmarkIndex();
fs.writeFileSync(path.join(output,'index-benchmark.json'),JSON.stringify(benchmark,null,2)+'\n');
const events=JSON.parse(fs.readFileSync(evidence));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const phases=events.filter(e=>e.event);
const names={restart:'Перезапуск сервера',main_transaction_rollback:'Откат записи основного сайта',lesson_transaction_rollback:'Откат удаления вопроса и ответов',backup_without_sessions:'Резервная копия без сессий',restore_and_fresh_login:'Восстановление и повторный вход'};
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Медиум — проверка SQLite</title>
<style>body{font:18px/1.5 system-ui;margin:0;background:#f3f1fb;color:#202033}main{max-width:1140px;margin:auto;padding:36px}h1{font-size:38px}h2{margin:0 0 16px}section{background:white;border:1px solid #d7d2e5;border-radius:18px;padding:28px;margin:22px 0}table{border-collapse:collapse;width:100%;font-size:16px}td,th{text-align:left;border-bottom:1px solid #ddd;padding:10px;vertical-align:top}code{font-family:monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap}strong{color:#463178}.pass{color:#23634b}.small{font-size:15px;color:#616172}.bar{height:28px;background:#9165d8;min-width:3px;margin:12px 0;border-radius:6px}</style>
<main><h1>Медиум Проверка SQLite</h1><p>Настоящий локальный сервер, отдельная временная база и синтетические аккаунты. Рабочий сайт и внешние AI API не использовались.</p>
<section id="verification"><h2>Сохранение и целостность</h2><table><tr><th>Проверка</th><th>Результат</th></tr>${phases.map(e=>`<tr><td>${names[e.event]}</td><td class="pass">Подтверждено автоматическим запросом и проверкой данных</td></tr>`).join('')}</table><p>Старые сессии работают после обычного перезапуска. После восстановления из резервной копии они недействительны; вход с прежним паролем работает.</p></section>
<section id="index"><h2>Индекс на 10 000 ответах</h2><p>Один и тот же запрос возвращает ${benchmark.matches} совпадений. Медиана ${benchmark.rounds} серий по ${benchmark.iterations} запросов после прогрева.</p>
<p>Без индекса: <strong>${benchmark.beforeMs.toFixed(4)} мс</strong></p><div class="bar" style="width:90%"></div>
<p>С индексом: <strong>${benchmark.afterMs.toFixed(4)} мс</strong></p><div class="bar" style="width:${Math.max(1,90/benchmark.speedup)}%"></div>
<p>В этом запуске запрос быстрее в ${benchmark.speedup.toFixed(1)} раза. Это измерение локального SQL-запроса, не скорости сайта целиком.</p>
<pre>${escape(benchmark.beforePlan.join('\n'))}\n${escape(benchmark.afterPlan.join('\n'))}</pre></section>
<section id="api"><h2>Запросы к API</h2><p class="small">Токены, пароли и содержимое закрытых файлов в журнал не включены. Это журнал автоматической проверки, не скриншот Postman.</p><table><tr><th>Метод и адрес</th><th>HTTP</th><th>Результат</th></tr>${events.filter(e=>e.path).map(e=>`<tr><td><code>${escape(e.method+' '+e.path)}</code></td><td>${e.status}</td><td><code>${escape(JSON.stringify(e.summary))}</code></td></tr>`).join('')}</table></section>
<section><h2>Что проверялось при сбое</h2><p>В тестовой базе временный SQL-триггер намеренно отклоняет вставку ответа. API возвращает 503, а состояние совпадает с предыдущим. Другой триггер отклоняет удаление вопроса после удаления его ответов: ROLLBACK возвращает и вопрос, и ответы. Триггеры удаляются тестом; тестовых ручек для сбоев в сервере нет.</p></section></main></html>`;
fs.writeFileSync(path.join(output,'report.html'),html);
console.log(JSON.stringify({verified:true,apiRequests:events.filter(e=>e.path).length,checks:phases.length,indexSpeedup:benchmark.speedup,report:path.join(output,'report.html')}));
