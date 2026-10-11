import React, { useState } from 'react';
import { useApp } from './context';

const errors = {
  AI_NOT_CONFIGURED: 'AI-помощник пока не подключён к GigaChat.',
  AI_BUSY: 'Лимит AI-запросов временно достигнут или помощник занят. Попробуй позже; вопрос можно опубликовать для студентов.',
  AI_QUEUE_FULL: 'Очередь AI заполнена. Попробуй немного позже.',
  AI_QUEUE_TIMEOUT: 'Ответ не удалось подготовить за время ожидания. Попробуй ещё раз позже.',
  AI_INVALID_QUESTION: 'Напиши вопрос от 8 до 2200 символов.',
  AI_NOT_ALLOWED: 'Запросить ответ для публикации может её автор.',
  AUTH_REQUIRED: 'Войди, чтобы спросить AI.',
};
export function AIAnswer({ answer }) {
  if (!answer) return null;
  return <div className="ai-answer" aria-live="polite">
    <div className="ai-answer-heading"><span className="ai-badge">AI</span><strong>Помощник РЭУ</strong></div>
    {answer.status === 'pending' ? <p role="status">Ищу информацию в источниках РЭУ…</p> : answer.status === 'error' ?
      <p>{errors[answer.error] || 'AI сейчас недоступен. Студенты всё ещё могут ответить на вопрос.'}</p> : <>
        <p className="ai-answer-body">{answer.body}</p>
        {!!answer.sources?.length && <div className="ai-sources"><strong>Источники</strong><ol>{answer.sources.map(s =>
          <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a><small>Проверено {s.checkedAt}</small></li>)}</ol></div>}
        <small>Ответ AI по официальным источникам. Важные сроки и условия уточняй в РЭУ.</small>
      </>}
  </div>;
}
export default function UniversityAssistant({ question }) {
  const { me, askAI, requireUser } = useApp();
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canRequest = !question || me?.id === question.authorId || me?.role === 'admin';
  async function ask(e) {
    e.preventDefault();
    if (!requireUser('/questions')) return;
    setBusy(true); setError('');
    try { const result = await askAI(question ? { questionId: question.id } : { question: text }); setAnswer(result.answer); }
    catch (err) { setError(errors[err.message] || 'Не удалось получить ответ AI. Попробуй позже.'); }
    finally { setBusy(false); }
  }
  return <section className="university-assistant panel">
    {!question && <><h2>Спроси помощника РЭУ</h2><p>Помогу найти информацию об учёбе, общежитии и сервисах университета.</p></>}
    <AIAnswer answer={answer || question?.aiResponse} />
    {canRequest && (!question || question.aiResponse?.status !== 'ready') && <form onSubmit={ask}>
      {!question && <label>Твой вопрос<textarea value={text} onChange={e => setText(e.target.value)} maxLength={2200} rows={2} placeholder="Где найти расписание занятий?" /></label>}
      <p className="ai-privacy">Текст вопроса будет отправлен в GigaChat. Не добавляй пароли и личные документы.</p>
      <button className="button button-gradient" type="submit" disabled={busy || question?.aiResponse?.status === 'pending'}>{busy ? 'Ищу ответ…' : 'Спросить AI'}</button>
      {error && <p className="ai-error" role="alert">{error}</p>}
    </form>}
  </section>;
}
