import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { openSqliteStore } from '../server/sqlite-store.js';
import { createSeed } from '../src/data.js';

export function benchmarkIndex() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medium-index-'));
  const store=openSqliteStore({file:path.join(dir,'medium.sqlite')});
  try {
    const state=createSeed();const base=state.questions[0];
    state.questions=Array.from({length:100},(_,i)=>({...base,id:'bench-q-'+i}));
    state.answers=Array.from({length:10000},(_,i)=>({id:'bench-a-'+i,questionId:'bench-q-'+i%100,authorId:state.users[1].id,body:'Тестовый ответ',rating:null,createdAt:i}));
    store.write({state,sessions:{}});
    const sql=store.sql, query='SELECT count(*) AS n FROM answers WHERE question_id=?';
    const measure=()=>{
      const statement=sql.prepare(query);for(let i=0;i<20;i++) statement.get('bench-q-42');
      const samples=[];
      for(let run=0;run<7;run++){const start=performance.now();for(let i=0;i<200;i++) statement.get('bench-q-42');samples.push((performance.now()-start)/200);}
      return samples.sort((a,b)=>a-b)[3];
    };
    sql.exec('DROP INDEX answers_question');
    const beforePlan=sql.prepare('EXPLAIN QUERY PLAN '+query).all('bench-q-42').map(r=>r.detail);
    const beforeMs=measure();
    sql.exec('CREATE INDEX answers_question ON answers(question_id,position)');
    const afterPlan=sql.prepare('EXPLAIN QUERY PLAN '+query).all('bench-q-42').map(r=>r.detail);
    const afterMs=measure();
    return {rows:10000,matches:sql.prepare(query).get('bench-q-42').n,iterations:200,rounds:7,
      metric:'Median milliseconds per count query after warmup',beforeMs,afterMs,speedup:beforeMs/afterMs,beforePlan,afterPlan,
      note:'Synthetic local benchmark; filesystem cache is warm. This is not total API latency or a production measurement.'};
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(benchmarkIndex(),null,2));
