import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { availableGigaChatModels, generateUniversityAnswer, gigaChat, loadConfig, providerConfigured, answerKnowledgeVersion } from '../server/rag.js';

const baseCases = [
  { question: 'Какой кабинет вуса?', includes: ['100'], source: 'military-registration' },
  { question: 'Какой кабинет ВУЦ?', includes: ['VUC@rea.ru'], excludes: ['100'], source: 'military-training' },
  { question: 'Где сектор записи читателей?', includes: ['301'], source: 'library-registration' },
  { question: 'Какой кабинет отдела социальной работы?', includes: ['343'], source: 'social' },
  { question: 'Где кабинет отдела стран Европы?', includes: ['649'], source: 'international-europe' },
  { question: 'Где кабинет деканата?', grounded: false },
  { question: 'Как найти расписание занятий?', source: 'schedule', includes: ['rasp.rea.ru'] },
  { question: 'Не приходит письмо с логином и паролем', source: 'account' },
  { question: 'Сколько дней ждать студенческий билет?', excludes: ['через 15 дней', 'через 7 дней'] },
];
const extraCases = [
  { question: 'Какие документы нужны для записи в библиотеку?', source: 'library-registration', includes: ['студенческий билет'] },
  { question: 'Сколько стоит общежитие и гарантировано ли свободное место?', source: 'dormitory' },
  { question: 'Как иностранному студенту оформить приглашение?', source: 'international' },
];
const cases = process.argv.includes('--extra-only') ? extraCases : baseCases;

const live = process.argv.includes('--live');
const outIndex = process.argv.indexOf('--output');
const output = outIndex >= 0 ? process.argv[outIndex + 1] : null;
if (outIndex >= 0 && !output) throw Error('Missing --output path');
const report = { knowledgeVersion: answerKnowledgeVersion, live, createdAt: new Date().toISOString(), rows: [] };
if (live && !providerConfigured()) {
  console.error('AI_NOT_CONFIGURED: configure a private DATA_DIR outside the repository first.');
  process.exit(1);
}
// Dry mode checks the pipeline only, never pretends to compare real models.
const models = live ? [...new Set([loadConfig().model, 'GigaChat-2-Pro'])] : ['offline-pipeline'];
const available = live ? await availableGigaChatModels() : [];
let calls = 0;
for (const model of models) {
  if (live && !available.includes(model)) { report.rows.push({ model, error: 'MODEL_UNAVAILABLE' }); continue; }
  for (const sample of cases) {
    let usage = null;
    let generated = false;
    const started = performance.now();
    try {
      const answer = await generateUniversityAnswer(sample.question, async (messages, options) => {
        generated = true;
        if (!live) throw Error('LIVE_MODEL_NOT_RUN');
        if (++calls > 20) throw Error('REQUEST_BUDGET_EXCEEDED');
        return gigaChat(messages, { ...options, model, onUsage: value => { usage = value; } });
      });
      // These checks are gates, not a semantic accuracy score; manual review is required.
      const checks = {
        source: !sample.source || answer.sources.some(s => s.id === sample.source),
        includes: (sample.includes || []).every(term => `${answer.body} ${answer.sources.map(s => s.url).join(' ')}`.includes(term)),
        excludes: (sample.excludes || []).every(term => !answer.body.includes(term)),
        grounded: sample.grounded === undefined || sample.grounded === answer.grounded,
      };
      report.rows.push({ model, question: sample.question, generated, milliseconds: Math.round(performance.now() - started), usage, checks, answer });
    } catch (err) {
      const safe = ['LIVE_MODEL_NOT_RUN', 'REQUEST_BUDGET_EXCEEDED', 'AI_BUSY', 'AI_TIMEOUT', 'AI_NOT_CONFIGURED', 'AI_PROVIDER_ERROR', 'AI_CONNECTION_ERROR', 'AI_CREDENTIAL_ERROR'].includes(err.message) ? err.message : 'AI_UNAVAILABLE';
      report.rows.push({ model, question: sample.question, generated, error: safe });
      // No repeated probes after quota, credential, or transport failures.
      if (live) break;
    }
  }
}
report.providerCalls = calls;
const text = JSON.stringify(report, null, 2);
if (output) fs.writeFileSync(output, text + '\n', { mode: 0o600 });
else console.log(text);
