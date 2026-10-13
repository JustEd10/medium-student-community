import { AIFeedbackControl } from './Community';
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
export function AIAnswer({ answer, question, questionId }) {
  const { me } = useApp();
  if (!answer) return null;
  return <div className="ai-answer" aria-live="polite">
    <div className="ai-answer-heading"><span className="ai-badge">AI</span><strong>Помощник РЭУ</strong></div>
    {answer.status === 'pending' ? <p role="status">Ищу информацию в источниках РЭУ…</p> : answer.status === 'error' ?
      <p>{errors[answer.error] || 'AI сейчас недоступен. Студенты всё ещё могут ответить на вопрос.'}</p> : <>
        <p className="ai-answer-body">{answer.body}</p>
        {!!answer.sources?.length && <div className="ai-sources"><strong>Источники</strong><ol>{answer.sources.map(s =>
          <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a><small>Проверено {s.checkedAt}{s.sourceNote && ` · ${s.sourceNote}`}</small></li>)}</ol></div>}
        <small>Ответ по базе знаний Медиума. Источники и уточнения указаны выше; важные сведения уточняй в РЭУ.</small>
        {me && question && <AIFeedbackControl questionId={questionId} question={question} answer={answer} />}
      </>}
  </div>;
}
export default function UniversityAssistant({ question, onAskStudents }) {
  const { me, askAI, requireUser, t } = useApp();
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [askedText, setAskedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canRequest = !question || me?.id === question.authorId || me?.role === 'admin';
  async function ask(e) {
    e.preventDefault();
    if (!requireUser('/questions')) return;
    setBusy(true); setError(''); setAskedText(text);
    try { const result = await askAI(question ? { questionId: question.id } : { question: text }); setAnswer(result.answer); }
    catch (err) { setError(errors[err.message] || 'Не удалось получить ответ AI. Попробуй позже.'); }
    finally { setBusy(false); }
  }
  return <section className="university-assistant panel">
    {!question && <><h2>{t('Спросить AI по справочнику РЭУ', 'Ask AI about REU')}</h2><p>{t('Отвечает по базе знаний об университете. Советы о кафе, местах и личном опыте лучше спросить у студентов.', 'Uses the university knowledge base. Ask students for cafés, local tips and personal experience.')}</p></>}
    <AIAnswer answer={answer || question?.aiResponse} question={question ? `${question.title}\n${question.body}` : askedText} questionId={question?.id} />
    {onAskStudents && answer?.grounded === false && <p className="ai-community-hint">{t('В справочнике нет точного ответа. Студенты могут знать — перенеси вопрос в сообщество.', 'The directory has no precise answer. Students may know — ask the community.')}</p>}
    {canRequest && <form onSubmit={ask}>
      {!question && <label>Твой вопрос<textarea value={text} onChange={e => { setText(e.target.value); setAnswer(null); }} maxLength={2200} rows={2} placeholder="Где найти расписание занятий?" /></label>}
      <p className="ai-privacy">Текст вопроса будет отправлен в GigaChat. Не добавляй пароли и личные документы.</p>
      <button className="button button-gradient" type="submit" disabled={busy || question?.aiResponse?.status === 'pending'}>{busy ? 'Ищу ответ…' : 'Спросить AI'}</button>
      {error && <p className="ai-error" role="alert">{error}</p>}
      {onAskStudents && <button className="button button-secondary" type="button" disabled={busy || !text.trim()} onClick={() => onAskStudents(answer ? askedText : text)}>{t('Задать этот вопрос студентам', 'Ask students this question')}</button>}
      {onAskStudents && <small>{t('Откроется форма публикации. Вопрос появится в сообществе только после твоего подтверждения.', 'Opens the publishing form. Your question is shared only when you publish it.')}</small>}
    </form>}
  </section>;
}
