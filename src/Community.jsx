import React, { useEffect, useState } from 'react';
import { useApp } from './context';
import './community.css';
const errorText = e => ({ AUTH_REQUIRED: 'Войдите в аккаунт.', ADMIN_REQUIRED: 'Доступ только администратору.', RATE_LIMIT: 'Слишком много обращений. Попробуйте позже.', INVALID_DATA: 'Проверьте поля: причина должна содержать не менее 5 символов.', ALREADY_REVIEWED: 'Обращение уже рассмотрено.' }[e.message] || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
function FeedbackForm({ path, payload, label }) {
  const { communityRequest } = useApp();
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setBusy(true); setMessage(''); try { await communityRequest(path, { method: 'POST', body: { ...payload, reason } }); setMessage('Обращение передано администратору.'); setOpen(false); setReason(''); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); } }
  return <div className="community-control"><button type="button" className="community-link" onClick={() => setOpen(!open)} aria-expanded={open}>{label}</button>{open && <form onSubmit={submit}><label>Что нужно проверить?<textarea required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><button disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</button></form>}{message && <p role="status">{message}</p>}</div>;
}
export function ReportControl({ kind, id }) { return <FeedbackForm path="/reports" payload={{ kind, id }} label="Пожаловаться" />; }
export function AIFeedbackControl({ questionId, answer, question }) { return <FeedbackForm path="/ai-feedback" payload={{ questionId, answer: typeof answer === 'string' ? answer : answer?.body || '', question }} label="В ответе AI есть ошибка" />; }
export function BanAppeal() {
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form)); setBusy(true); setMessage(''); try { const response = await fetch('/api/app/community/appeals/authenticated', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage(result.message); form.reset(); } catch (err) { setMessage(errorText(err)); } finally { setBusy(false); } }
  return <section className="community-panel panel"><h2>Обжаловать блокировку</h2><p>Укажите данные заблокированного аккаунта и объясните, почему решение стоит пересмотреть.</p><form onSubmit={submit}><label>Почта или логин<input name="identity" autoComplete="username" maxLength={254} required /></label><label>Пароль<input name="password" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></label><label>Причина апелляции<textarea name="reason" minLength={5} maxLength={2000} required /></label><button disabled={busy}>{busy ? 'Отправляем…' : 'Отправить апелляцию'}</button></form><p role="status">{message}</p></section>;
}
function ReviewItem({ item, collection, onReview }) {
  const { state } = useApp();
  const name = id => { const user = state.users.find(u => u.id === id); return user ? `${user.firstName} ${user.lastName}` : 'Пользователь'; };
  const target = item.kind === 'question' ? state.questions.find(q => q.id === item.targetId) : item.kind === 'answer' ? state.answers.find(a => a.id === item.targetId) : item.kind === 'help' ? state.helpRequests.find(h => h.id === item.targetId) : state.users.find(u => u.id === item.targetId);
  const href = item.kind === 'question' ? `/questions/${item.targetId}` : item.kind === 'answer' ? `/questions/${target?.questionId}` : item.kind === 'help' ? '/study' : `/people/${item.targetId}`;
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  return <article className="community-item"><p><strong>{item.kind || (collection === 'appeals' ? 'Апелляция' : 'Ответ AI')}</strong> · {new Date(item.createdAt).toLocaleString('ru-RU')}</p>{item.targetId && <p><a href={`#${href}`}>{target?.title || target?.subject || target?.body || name(item.targetId)}</a></p>}<p>Автор обращения: {name(item.authorId)}</p>{collection === 'appeals' && <a href={`#/moderation`}>Управление блокировками</a>}{item.question && <p>Вопрос: {item.question}</p>}{item.answer && <blockquote>{item.answer}</blockquote>}<p>{item.reason}</p>{item.status === 'open' ? <form onSubmit={async e => { e.preventDefault(); const status = e.nativeEvent.submitter?.value || 'resolved'; setBusy(true); try { await onReview(collection, item.id, status, reason); } finally { setBusy(false); } }}><label>Обоснование решения<textarea required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="community-actions"><button value="resolved" disabled={busy}>Рассмотрено</button><button value="dismissed" disabled={busy}>Отклонить</button></div>{collection === 'appeals' && <small>Для снятия блокировки откройте управление пользователями.</small>}</form> : <p>{item.status === 'resolved' ? 'Рассмотрено' : 'Отклонено'}: {item.decision}</p>}</article>;
}
function DirectoryItem({ item, onSave }) {
  const [busy, setBusy] = useState(false);
  const fields = { office: 'Кабинет', building: 'Корпус', hours: 'Часы приёма', contact: 'Контакты', checkedAt: 'Дата проверки', source: 'Ссылка на источник' };
  return <details className="community-item"><summary>{item.title}</summary><p>{item.text}</p><form onSubmit={async e => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); try { await onSave(item.id, values); } finally { setBusy(false); } }}>{Object.entries(fields).map(([key, label]) => <label key={key}>{label}<input name={key} type={key === 'checkedAt' ? 'date' : key === 'source' ? 'url' : 'text'} required={['checkedAt', 'source'].includes(key)} maxLength={key === 'source' ? 1500 : ['office', 'building'].includes(key) ? 180 : 500} defaultValue={item.directory?.[key] || (key === 'source' ? item.url : key === 'checkedAt' ? item.checkedAt : '')} /></label>)}<button disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить сведения'}</button></form></details>;
}
export function CommunityAdmin() {
  const { communityRequest, state } = useApp();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('reports');
  const [refreshing, setRefreshing] = useState(false);
  const tabs = [['reports', 'Жалобы'], ['aiFeedback', 'Ошибки AI'], ['appeals', 'Апелляции'], ['directory', 'Справочник РЭУ'], ['history', 'История решений']];
  const name = id => { const user = state.users.find(u => u.id === id); return user ? `${user.firstName} ${user.lastName}` : 'Администратор'; };
  const targetLabel = log => {
    if (log.action === 'directory.updated') return data?.directory.find(item => item.id === log.target)?.title || 'Справочник РЭУ';
    const [kind, id] = log.target.split(':');
    if (kind === 'user') return name(id);
    const item = kind === 'question' ? state.questions.find(q => q.id === id) : kind === 'answer' ? state.answers.find(a => a.id === id) : kind === 'help' ? state.helpRequests.find(h => h.id === id) : null;
    if (item) return item.title || item.subject || item.body;
    const request = [...(data?.reports || []), ...(data?.aiFeedback || []), ...(data?.appeals || [])].find(r => r.id === log.target);
    return request?.question || (request ? `Обращение: ${name(request.authorId)}` : '');
  };
  const actionLabels = { 'user.banned': 'Аккаунт заблокирован', 'user.unbanned': 'Блокировка снята', deleteContent: 'Публикация удалена', restoreContent: 'Удаление отменено', dismissAIReview: 'Отметка AI снята', retryAIReview: 'Проверка AI запрошена повторно', 'directory.updated': 'Справочник обновлён' };
  const actionLabel = value => actionLabels[value] || (value.endsWith('.resolved') ? 'Обращение рассмотрено' : value.endsWith('.dismissed') ? 'Обращение отклонено' : 'Решение администратора');
  const refresh = async () => { setRefreshing(true); try { setData(await communityRequest('/admin')); } catch (e) { setMessage(errorText(e)); } finally { setRefreshing(false); } };
  useEffect(() => { let alive = true; communityRequest('/admin').then(value => { if (alive) setData(value); }).catch(e => { if (alive) setMessage(errorText(e)); }); return () => { alive = false; }; }, [communityRequest]);
  async function change(path, method, body) { setMessage(''); try { await communityRequest(path, { method, body }); await refresh(); setMessage('Сохранено.'); } catch (e) { setMessage(errorText(e)); } }
  return <section className="community-panel panel">
    <div className="community-actions"><h2>Обращения и справочник</h2><button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? 'Обновляем…' : 'Обновить'}</button></div>
    <p role="status">{message}</p>
    {!data ? <p>Загрузка…</p> : <>
      <details className="backup-health"><summary>Резервные копии {data.backups?.error ? '· есть ошибка' : data.backups?.lastSuccessAt ? '· проверены' : '· ожидают сохранения'}</summary>
        <p>{data.backups?.lastSuccessAt ? `Последняя проверенная копия: ${new Date(data.backups.lastSuccessAt).toLocaleString('ru-RU')}` : 'Проверенной копии пока нет.'}</p>
        {data.backups?.error && <p role="alert">Не удалось сохранить резервную копию. Нужно проверить хранилище.</p>}
        <p>{data.backups?.destinationConfigured ? 'Каталог копий настроен. Проверь, что он находится на отдельном защищённом диске.' : 'Копии на том же сервере. Внешнее хранилище пока не подключено.'}</p>
        <p>{data.backups?.drive?.configured ? data.backups.drive.lastSuccessAt ? `Google Диск: копия загружена и проверена ${new Date(data.backups.drive.lastSuccessAt).toLocaleString('ru-RU')}` : 'Google Диск подключён. Первая проверенная загрузка ещё не завершена.' : 'Google Диск пока не подключён.'}</p>
        {data.backups?.drive?.error === 'DRIVE_BACKUP_UNAVAILABLE' && <p role="alert">Загрузка на Google Диск не завершилась. Локальная копия сохранена; сервер повторит попытку.</p>}
      </details>
      <nav className="community-tabs" aria-label="Обращения администратора">{tabs.map(([key, title]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}{data[key]?.filter(item => item.status === 'open').length > 0 && ` (${data[key].filter(item => item.status === 'open').length})`}</button>)}</nav>
      {['reports', 'aiFeedback', 'appeals'].includes(tab) && <section aria-label={tabs.find(([key]) => key === tab)[1]}>
        {!data[tab].length && <p>Обращений пока нет.</p>}
        {[...data[tab]].reverse().map(item => <ReviewItem key={item.id} item={item} collection={tab} onReview={(collection, id, status, reason) => change(`/admin/${collection}/${id}`, 'PATCH', { status, reason })} />)}
      </section>}
      {tab === 'directory' && <section><p>Изменяй кабинет, корпус, часы приёма и контакты. Укажи источник и дату проверки; AI использует новые сведения при следующем запросе.</p>{data.directory.filter(item => item.office).map(item => <DirectoryItem key={`${item.id}:${item.checkedAt}:${item.text}`} item={item} onSave={(id, body) => change(`/admin/directory/${id}`, 'PUT', body)} />)}</section>}
      {tab === 'history' && <section>{!data.moderationLog.length && <p>Решений пока нет.</p>}{[...data.moderationLog].reverse().map(item => <article className="community-item" key={item.id}><p><strong>{actionLabel(item.action)}</strong> · {new Date(item.createdAt).toLocaleString('ru-RU')}</p>{targetLabel(item) && <p>{targetLabel(item)}</p>}{item.reason && <p>{item.reason}</p>}<small>{name(item.actorId)}</small></article>)}</section>}
    </>}
  </section>;
}
