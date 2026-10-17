import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from './context';
import { fullName, uid } from './domain';
import { DeleteControl } from './AdminModeration';
import { isBotUser, BOT_ERROR_TEXT } from './bot-personas';
import {
  Avatar,
  Empty,
  Field,
  FormErrors,
  Icon,
  Link,
  LoginGate,
  PageTitle,
  Tags,
} from './components';

export function Chats({ id }) {
  const { state, me, act, t, locale } = useApp();
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState({});
  const listRef = useRef(null);
  const formRef = useRef(null);
  const inputRef = useRef(null);
  const sending = useRef(false);
  const activeChat = useRef(null);
  const [pending, setPending] = useState(false);
  const [outbox, setOutbox] = useState([]);
  const reading = useRef(new Set());
  const actRef = useRef(act);
  actRef.current = act;
  const chats = state.chats
    .filter((c) => c.members.includes(me?.id))
    .sort((a, b) => (b.messages.at(-1)?.createdAt || 0) - (a.messages.at(-1)?.createdAt || 0));
  const current = id ? chats.find((c) => c.id === id) : chats[0];
  activeChat.current = current?.id;
  const partner =
    current && state.users.find((u) => u.id === current.members.find((m) => m !== me?.id));
  const bot = isBotUser(partner);
  const botWaiting = bot && current?.botJob?.status === 'pending';
  const botLocked = bot && (!state.chatAI?.ready || !current?.botConsentAt || current?.botConsentProvider !== state.chatAI?.provider || botWaiting);
  const [consentBusy, setConsentBusy] = useState(false);
  const localMessages = outbox.filter(message =>
    message.chatId === current?.id && message.senderId === me?.id &&
    !current.messages.some(saved => saved.clientId === message.clientId),
  );
  const messages = [...(current?.messages || []), ...localMessages];
  useEffect(() => { setOutbox([]); }, [me?.id]);
  useEffect(() => {
    setBody('');
    setErrors({});
  }, [current?.id]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [current?.id, current?.messages.length, localMessages.length]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !current || !me) return;
    function markVisibleMessages() {
      if (document.hidden || !document.hasFocus() || !list.getClientRects().length) return;
      const clip = list.getBoundingClientRect();
      const top = Math.max(0, clip.top);
      const bottom = Math.min(window.innerHeight, clip.bottom);
      const left = Math.max(0, clip.left);
      const right = Math.min(window.innerWidth, clip.right);
      if (bottom <= top || right <= left) return;
      let throughId;
      for (const element of list.querySelectorAll('[data-message-id]')) {
        const message = current.messages.find(m => m.id === element.dataset.messageId);
        if (!message || message.senderId === me.id || message.readAt != null) continue;
        const box = element.getBoundingClientRect();
        if (box.bottom > top && box.top < bottom && box.right > left && box.left < right)
          throughId = message.id;
      }
      if (!throughId) return;
      const key = `${me.id}:${current.id}:${throughId}`;
      if (reading.current.has(key)) return;
      reading.current.add(key);
      actRef.current('markChatRead', { chatId: current.id, throughId }, { silent: true })
        .finally(() => reading.current.delete(key));
    }
    markVisibleMessages();
    list.addEventListener('scroll', markVisibleMessages, { passive: true });
    window.addEventListener('scroll', markVisibleMessages, { passive: true });
    window.addEventListener('resize', markVisibleMessages);
    window.addEventListener('focus', markVisibleMessages);
    document.addEventListener('visibilitychange', markVisibleMessages);
    return () => {
      list.removeEventListener('scroll', markVisibleMessages);
      window.removeEventListener('scroll', markVisibleMessages);
      window.removeEventListener('resize', markVisibleMessages);
      window.removeEventListener('focus', markVisibleMessages);
      document.removeEventListener('visibilitychange', markVisibleMessages);
    };
  }, [current?.id, current?.messages, me?.id]);
  useLayoutEffect(() => {
    function resizeInput() {
      const input = inputRef.current;
      if (!input) return;
      const style = window.getComputedStyle(input);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const maxHeight = parseFloat(style.lineHeight) * 5 + padding;
      input.style.height = '0px';
      const contentHeight = input.scrollHeight;
      input.style.height = `${Math.min(maxHeight, Math.max(44, contentHeight))}px`;
      input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    }
    resizeInput();
    window.addEventListener('resize', resizeInput);
    return () => window.removeEventListener('resize', resizeInput);
  }, [body, current?.id]);
  if (!me)
    return <LoginGate next={id ? `/chats/${id}` : '/chats'} title={t('Общение', 'Messages')} />;
  if (id && !current)
    return (
      <Empty title={t('Диалог не найден', 'Conversation not found')}>
        <Link to="/chats" className="button">
          {t('Все сообщения', 'All messages')}
        </Link>
      </Empty>
    );
  async function send(message) {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setErrors({});
    setOutbox(previous => [
      ...previous.filter(item => item.clientId !== message.clientId),
      { ...message, status: 'sending' },
    ]);
    try {
      if (await act('sendMessage', {
        chatId: message.chatId, body: message.body, clientId: message.clientId,
      })) {
        setOutbox(previous => previous.filter(item => item.clientId !== message.clientId));
        if (activeChat.current === message.chatId) {
          setBody(value => value === message.body ? '' : value);
          setErrors({});
        }
      } else {
        setOutbox(previous => previous.map(item => item.clientId === message.clientId
          ? { ...item, status: 'failed' } : item));
      }
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  function submit(e) {
    e.preventDefault();
    if (sending.current || botLocked) return;
    if (!body.trim()) {
      setErrors({ body: t('Напиши сообщение.', 'Write a message.') });
      return;
    }
    const failed = localMessages.find(message => message.status === 'failed' && message.body === body);
    send(failed || {
      id: uid(), clientId: uid(), chatId: current.id, senderId: me.id,
      body, createdAt: Date.now(),
    });
  }
  function status(message) {
    const value = message.status || (message.readAt != null ? 'read' : 'sent');
    const label = {
      sending: t('Отправляется', 'Sending'), sent: t('Отправлено', 'Sent'),
      read: t('Прочитано', 'Read'), failed: t('Не отправлено. Повторить', 'Not sent. Retry'),
    }[value];
    if (value === 'failed') return (
      <button type="button" className="message-retry" disabled={pending}
        aria-label={label} title={label} data-message-status={value} onClick={() => send(message)}>
        <Icon name="message-failed" />{t('Повторить', 'Retry')}
      </button>
    );
    return <span className={`message-status message-status-${value}`} role="img"
      aria-label={label} title={label} data-message-status={value}>
      <Icon name={`message-${value}`} />
    </span>;
  }
  const date = (value) =>
    new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'long',
    }).format(value);
  const time = (value) =>
    new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  return (
    <>
      <PageTitle
        title={t('Общение', 'Messages')}
        description={t('Твои разговоры со студентами', 'Your conversations with other students')}
      />
      <div className={`chats-layout ${id ? 'chat-open' : ''}`}>
        <aside
          className="conversation-list panel"
          aria-label={t('Список диалогов', 'Conversations')}
        >
          <h2>{t('Сообщения', 'Messages')}</h2>
          <div
            className="conversation-scroll"
            role="region"
            aria-label={t('Диалоги', 'Chat list')}
            tabIndex={0}
          >
            {chats.length ? (
              chats.map((chat) => {
                const user = state.users.find(
                  (u) => u.id === chat.members.find((m) => m !== me.id),
                );
                return (
                  <Link
                    to={`/chats/${chat.id}`}
                    key={chat.id}
                    className={current?.id === chat.id ? 'conversation active' : 'conversation'}
                    aria-current={current?.id === chat.id ? 'page' : undefined}
                  >
                    <Avatar user={user} />
                    <span>
                      <strong>{fullName(user)}</strong>
                      <small>
                        {chat.messages.at(-1)?.body || t('Начни разговор', 'Start a conversation')}
                      </small>
                    </span>
                  </Link>
                );
              })
            ) : (
              <p className="muted">
                {t('Здесь появятся твои диалоги.', 'Your conversations will appear here.')}
              </p>
            )}
          </div>
          <Link to="/people" className="text-link">
            {t('Найти новых людей', 'Meet new people')}
          </Link>
        </aside>
        <section className="chat-panel panel" aria-label={t('Переписка', 'Conversation')}>
          {current ? (
            <>
              <Link to="/chats" className="back-link mobile-back">
                ← {t('Все сообщения', 'All messages')}
              </Link>
              <Link to={`/people/${partner.id}`} className="chat-person person-heading">
                <Avatar user={partner} />
                <div>
                  <h2>{fullName(partner)}</h2>
                  <Tags values={partner.languages} />
                </div>
              </Link>
              <div
                className="message-scroll"
                ref={listRef}
                aria-label={t('Сообщения диалога', 'Conversation messages')}
                tabIndex={0}
              >
                {messages.length ? (
                  messages.map((message, index) => (
                    <React.Fragment key={message.id}>
                      {(index === 0 ||
                        date(message.createdAt) !==
                          date(messages[index - 1].createdAt)) && (
                        <p className="message-date">{date(message.createdAt)}</p>
                      )}
                      <article
                        data-message-id={message.status ? undefined : message.id}
                        className={`message ${message.senderId === me.id ? 'outgoing' : 'incoming'}`}
                        aria-label={
                          message.senderId === me.id
                            ? t('Твоё сообщение', 'Your message')
                            : fullName(partner)
                        }
                      >
                        <p>{message.body}</p>
                        <div className="message-meta">
                          <time dateTime={new Date(message.createdAt).toISOString()}>
                            {time(message.createdAt)}
                          </time>
                          {message.senderId === me.id && status(message)}
                          {!message.status && (message.senderId === me.id || me.role === 'admin') &&
                            <DeleteControl kind="message" id={message.id} label={t('Удалить сообщение', 'Delete message')} />}
                        </div>
                      </article>
                    </React.Fragment>
                  ))
                ) : (
                  <Empty
                    title={t('Начните с приветствия', 'Start with a hello')}
                    description={t(
                      'Расскажи, что у вас общего.',
                      'Talk about what you have in common.',
                    )}
                  />
                )}
              </div>
              {bot && <div className="bot-chat-info">
                <p>{state.chatAI?.provider === 'groq' ? 'Groq' : 'Gemini'} · {t('AI-собеседник для языковой практики', 'AI language partner')}</p>
                <details>
                  <summary>{t('Как обрабатываются сообщения', 'How messages are processed')}</summary>
                  <p>{t('Это вымышленный персонаж. Ответы могут содержать ошибки. Во внешний сервис передаются только последние сообщения этого диалога. Не отправляй личные данные.', 'This is a fictional character. Replies may contain mistakes. Only recent messages from this conversation go to the external service. Do not send personal data.')}</p>
                  {state.chatAI?.provider !== 'groq' && <p>{t('В бесплатном API Google может использовать текст для улучшения моделей.', 'Google may use free API text to improve its models.')}</p>}
                </details>
                {!state.chatAI?.ready && <p role="status">{t(...BOT_ERROR_TEXT.BOT_UNAVAILABLE)}</p>}
                <label className="bot-chat-consent">
                  <input type="checkbox" checked={!!current.botConsentAt && current.botConsentProvider === state.chatAI?.provider} disabled={consentBusy}
                    onChange={async event => {
                      setConsentBusy(true);
                      try { await act('setBotConsent', { chatId: current.id, consent: event.target.checked }); }
                      finally { setConsentBusy(false); }
                    }} />
                  <span>{t('Мне есть 18 лет. Разрешаю передавать сообщения этого чата в', 'I am 18 or older. I agree to send messages from this chat to')} {state.chatAI?.provider === 'groq' ? 'Groq' : 'Gemini'} {t('для ответа.', 'for replies.')}</span>
                </label>
                {botWaiting && <p role="status">{t('AI готовит ответ…', 'AI is preparing a reply…')}</p>}
                {current.botJob?.status === 'error' && <div role="status">
                  <p>{t(...(BOT_ERROR_TEXT[current.botJob.error] || BOT_ERROR_TEXT.BOT_FAILED))}</p>
                  <button type="button" className="text-link" disabled={botLocked || pending}
                    onClick={() => act('retryBotReply', { chatId: current.id })}>{t('Повторить запрос к AI', 'Retry AI reply')}</button>
                </div>}
              </div>}
              <form ref={formRef} className="message-form" onSubmit={submit} aria-busy={pending} noValidate>
                <FormErrors errors={errors} />
                <Field
                  label={t('Написать сообщение', 'Write a message')}
                  error={errors.body}
                  className="message-field"
                  endAdornment={
                    <button
                      type="submit"
                      className="icon-button send-button"
                      disabled={pending || botLocked}
                      aria-label={t('Отправить сообщение', 'Send message')}
                    >
                      <Icon name="send" />
                    </button>
                  }
                >
                  <textarea
                    disabled={botLocked}
                    ref={inputRef}
                    rows={1}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        formRef.current.requestSubmit();
                      }
                    }}
                    maxLength={2000}
                    required
                    placeholder={t('Написать сообщение', 'Write a message')}
                  />
                </Field>
                <p className="message-key-hint">
                  {t(
                    'Enter отправляет сообщение. Shift + Enter добавляет новую строку.',
                    'Enter sends the message. Shift + Enter adds a new line.',
                  )}
                </p>
              </form>
            </>
          ) : (
            <Empty
              title={t('Выбери собеседника', 'Choose someone to talk to')}
              description={t(
                'Познакомься с людьми и начни общение.',
                'Meet people and start a conversation.',
              )}
            >
              <Link to="/people" className="button">
                {t('Знакомства', 'Meet people')}
              </Link>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
