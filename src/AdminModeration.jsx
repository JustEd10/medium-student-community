import React, { useState } from 'react';
import { useApp } from './context';
import { fullName } from './domain';
import { Avatar, Dialog, Empty, Field, Icon, Link, LoginGate, PageTitle } from './components';

export function DeleteControl({ kind, id, label, onDeleted }) {
  const { act, t } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (busy) return;
    setBusy(true);
    if (await act('deleteContent', { kind, id })) {
      setOpen(false);
      onDeleted?.();
    }
    setBusy(false);
  }
  return <>
    <button type="button" className="delete-control" title={label} aria-label={label}
      onClick={() => setOpen(true)}><Icon name="trash" /></button>
    <Dialog open={open} onClose={() => !busy && setOpen(false)} title={label}>
      <p>{t('После удаления у тебя будет 5 секунд, чтобы отменить действие.', 'You will have 5 seconds to undo deletion.')}</p>
      <div className="moderation-actions">
        <button type="button" className="button button-outline" disabled={busy} onClick={() => setOpen(false)}>
          {t('Отмена', 'Cancel')}
        </button>
        <button type="button" className="button button-danger" disabled={busy} onClick={remove}>
          {busy ? t('Удаление…', 'Deleting…') : t('Удалить', 'Delete')}
        </button>
      </div>
    </Dialog>
  </>;
}
export function Moderation() {
  const { state, me, t, act } = useApp();
  const [kind, setKind] = useState('user');
  const [search, setSearch] = useState('');
  if (!me) return <LoginGate next="/moderation" title={t('Модерация', 'Moderation')} />;
  if (me.role !== 'admin') return <Empty title={t('Нет доступа', 'Access denied')}>
    <Link to="/" className="button">{t('На главную', 'Go home')}</Link>
  </Empty>;
  const labels = {
    user: t('Анкеты', 'Profiles'), question: t('Вопросы', 'Questions'), answer: t('Ответы', 'Answers'),
    help: t('Заявки на помощь', 'Study requests'), message: t('Сообщения', 'Messages'),
  };
  const author = id => state.users.find(u => u.id === id);
  const rows = {
    user: state.users.filter(u => u.id !== me.id).map(u => ({ ...u, title: fullName(u), user: u, href: `/people/${u.id}` })),
    question: state.questions.map(q => ({ ...q, user: author(q.authorId), href: `/questions/${q.id}` })),
    answer: state.answers.map(a => ({ ...a, title: a.body, user: author(a.authorId), href: `/questions/${a.questionId}` })),
    help: state.helpRequests.map(h => ({ ...h, title: h.subject, user: author(h.authorId), href: '/study' })),
    message: state.chats.flatMap(c => c.messages.map(m => ({ ...m, title: m.body, user: author(m.senderId) }))),
  }[kind].filter(item => `${item.title} ${fullName(item.user)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <>
    <PageTitle title={t('Модерация', 'Moderation')}
      description={t('Управляй публикациями и блокировками аккаунтов.', 'Manage content and account bans.')} />
    <section className="moderation-panel panel">
      <div className="moderation-filters">
        <Field label={t('Раздел', 'Section')}><select value={kind} onChange={e => setKind(e.target.value)}>
          {Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></Field>
        <Field label={t('Поиск', 'Search')}><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></Field>
      </div>
      <p className="muted">{t('Найдено:', 'Found:')} {rows.length}</p>
      <ul className="moderation-list">{rows.map(item => <li key={item.id}>
        <Avatar user={item.user} />
        <div><small>{fullName(item.user)}</small><p>{item.href
          ? <Link to={item.href}>{item.title}</Link> : item.title}</p></div>
        {(kind !== 'user' || item.role !== 'admin') && <>
          {kind === 'user' && <button type="button" className="button button-outline"
            onClick={() => act('setUserBan', { id: item.id, banned: item.bannedAt == null })}>
            {item.bannedAt != null ? t('Разблокировать', 'Unban') : t('Заблокировать', 'Ban')}
          </button>}
          {item.bannedAt != null && <span>{t('Заблокирован', 'Banned')}</span>}
          <DeleteControl kind={kind} id={item.id} label={t('Удалить', 'Delete')} />
        </>}
      </li>)}</ul>
      {!rows.length && <p>{t('Здесь пока пусто.', 'Nothing here yet.')}</p>}
    </section>
  </>;
}
