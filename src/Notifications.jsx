import React, { useState } from 'react';
import { useApp } from './context';
import { Empty, Link, LoginGate, PageTitle } from './components';
export default function Notifications() {
  const { me, state, act, t } = useApp();
  const [busy, setBusy] = useState(false);
  if (!me) return <LoginGate next="/notifications" />;
  const items = state.notifications || [];
  const unread = items.filter(n => !n.read);
  const labels = { answer: t('На твой вопрос ответили', 'Your question has a new answer'), offer: t('На заявку откликнулись', 'Someone offered to help'), assigned: t('Тебя выбрали помощником', 'You were chosen to help'), completed: t('Помощь отмечена как полученная', 'Your help was marked as complete'), message: t('Пришло сообщение', 'You received a message') };
  return <>
    <PageTitle title={t('Уведомления', 'Notifications')} description={t('Ответы, отклики и сообщения — всё в одном месте.', 'Answers, help offers and messages in one place.')} />
    <section className="panel notifications-panel">
      {!!unread.length && <button className="button button-outline" type="button" disabled={busy} onClick={async () => {
        setBusy(true); await act('markNotificationsRead', { ids: unread.map(n => n.id) }); setBusy(false);
      }}>{t('Прочитать все', 'Mark all read')}</button>}
      <ul className="notification-list">{items.map(n => <li key={n.id} className={n.read ? '' : 'unread'}>
        <Link to={n.href} onClick={() => { if (!n.read) act('markNotificationsRead', { ids: [n.id] }, { silent: true }); }}>
          <strong>{labels[n.type]}</strong>{n.subject && <span>{n.subject}</span>}
          <time dateTime={new Date(n.createdAt).toISOString()}>{new Date(n.createdAt).toLocaleString(state.locale === 'en' ? 'en-GB' : 'ru-RU')}</time>
        </Link>
      </li>)}</ul>
      {!items.length && <Empty title={t('Пока нет уведомлений', 'No notifications yet')} description={t('Здесь появятся ответы на твои вопросы, отклики и сообщения.', 'Answers to your questions, help offers and messages will appear here.')} />}
    </section>
  </>;
}
