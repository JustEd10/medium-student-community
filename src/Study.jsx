import React, { useState } from 'react';
import { useApp, go } from './context';
import { commonItems, fullName, matches } from './domain';
import {
  Avatar,
  Empty,
  Field,
  FormErrors,
  Icon,
  Link,
  LoginGate,
  PageTitle,
  RatingPanel,
  SegmentedNav,
  Stars,
} from './components';

function MyRequest({ request }) {
  const { state, me, act, t, notify } = useApp();
  const [helper, setHelper] = useState(request.helpers[0] || '');
  return (
    <article className="my-request panel">
      <h3>{request.subject}</h3>
      <p>{request.body}</p>
      {request.status === 'completed' ? (
        <p className="completed-badge">
          {t('Помощь получена', 'Help received')} ·{' '}
          {fullName(state.users.find((u) => u.id === request.helperId))}
        </p>
      ) : request.helpers.length ? (
        <>
          <Field label={t('Кто помог?', 'Who helped you?')}>
            <select
              value={helper || request.helpers[0]}
              onChange={(e) => setHelper(e.target.value)}
            >
              {request.helpers.map((id) => (
                <option key={id} value={id}>
                  {fullName(state.users.find((u) => u.id === id))}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button button-green"
            onClick={async () => {
              if (
                await act('completeHelp', {
                  helpId: request.id,
                  helperId: helper || request.helpers[0],
                })
              )
                notify(
                  t(
                    'Помощь завершена. Теперь её можно оценить.',
                    'Help completed. You can now rate it.',
                  ),
                );
            }}
          >
            {t('Помощь получена', 'Help received')}
          </button>
        </>
      ) : (
        <p className="muted">
          {t(
            'Откликов пока нет. Запрос виден в разделе «Могу помочь».',
            'Waiting for offers. Your request is visible in “I can help”.',
          )}
        </p>
      )}
    </article>
  );
}
export function Study({ tab }) {
  const { state, me, act, t, notify, requireUser } = useApp();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState({});
  const [term, setTerm] = useState('');
  const [limit, setLimit] = useState(3);
  const [evaluation, setEvaluation] = useState('');
  const need = tab === 'need';
  const own = state.helpRequests.filter((h) => h.authorId === me?.id);
  const completed = own.filter((h) => h.status === 'completed' && h.helperId);
  const selected = completed.find((h) => h.id === evaluation) || completed[0];
  const available = state.helpRequests.filter(
    (h) => h.authorId !== me?.id && h.status === 'open' && matches(`${h.subject} ${h.body}`, term),
  );
  async function publish(e) {
    e.preventDefault();
    if (!requireUser('/study?tab=need')) return;
    const issues = {};
    if (subject.trim().length < 2)
      issues.subject = t(
        'Укажи предмет (хотя бы 2 символа).',
        'Enter a subject (at least 2 characters).',
      );
    if (body.trim().length < 10)
      issues.body = t(
        'Опиши проблему. Нужно хотя бы 10 символов.',
        'Describe the problem using at least 10 characters.',
      );
    setErrors(issues);
    if (Object.keys(issues).length) return;
    const submittedSubject = subject;
    const submittedBody = body;
    if (!(await act('addHelp', { subject: submittedSubject, body: submittedBody }))) return;
    setSubject(value => value === submittedSubject ? '' : value);
    setBody(value => value === submittedBody ? '' : value);
    notify(
      t(
        'Запрос опубликован. Другие студенты могут откликнуться.',
        'Request published. Other students can now offer help.',
      ),
    );
  }
  async function help(request) {
    if (!requireUser('/study')) return;
    if (!request.helpers.includes(me.id) && !(await act('offerHelp', { helpId: request.id })))
      return;
    const chat = await act('openChat', { partner: request.authorId });
    if (!chat) return;
    notify(
      t(
        'Отклик сохранён. Обсуди задачу в переписке.',
        'Offer saved. Discuss the task in messages.',
      ),
    );
    go(`/chats/${chat.id}`);
  }
  return (
    <>
      <PageTitle
        title={t('Помощь с учёбой', 'Study help')}
        description={t(
          'Если учиться на новом языке сложно, попроси объяснить тему или предложи свою помощь.',
          'If studying in a new language is difficult, ask someone to explain a topic or offer your help.',
        )}
      />
      <SegmentedNav
        className="study-tabs"
        label={t('Тип помощи', 'Study help options')}
        activeIndex={need ? 1 : 0}
        items={[
          ['/study', t('Могу помочь', 'I can help')],
          ['/study?tab=need', t('Нужна помощь', 'I need help')],
        ]}
      />
      <div key={need ? 'need' : 'list'} className="tab-content">
        {need ? (
          !me ? (
            <LoginGate next="/study?tab=need" />
          ) : (
            <>
              <div className="study-request-layout">
                <form className="help-form panel" onSubmit={publish} noValidate>
                  <h2>{t('С чем нужно помочь?', 'What do you need help with?')}</h2>
                  <FormErrors errors={errors} />
                  <Field label={t('Предмет', 'Subject')} error={errors.subject}>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      maxLength={80}
                      required
                    />
                  </Field>
                  <Field label={t('Проблема', 'Problem')} error={errors.body}>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={5}
                      maxLength={2000}
                      required
                    />
                  </Field>
                  <button type="submit" className="button button-green">
                    {t('Опубликовать', 'Publish')}
                  </button>
                </form>
                <aside className="help-tip panel">
                  <h2>{t('Расскажи, где возникла трудность', 'Explain where you are stuck')}</h2>
                  <p>
                    {t(
                      'Укажи предмет, тему и язык, на котором тебе удобно разбирать материал. Напиши, что уже пробовал сделать.',
                      'Mention the subject, topic and the language you would like to study in. Explain what you have already tried.',
                    )}
                  </p>
                  <strong>
                    {t(
                      'Так другим будет легче помочь.',
                      'This makes it easier for others to help.',
                    )}
                  </strong>
                </aside>
              </div>
              <section className="help-evaluation panel">
                <h2>{t('Оценить полученную помощь', 'Rate the help you received')}</h2>
                {completed.length ? (
                  <>
                    <Field label={t('Выбор помощи', 'Choose a completed request')}>
                      <select value={selected.id} onChange={(e) => setEvaluation(e.target.value)}>
                        {completed.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.subject} · {fullName(state.users.find((u) => u.id === h.helperId))}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Stars
                      label={t('Оценка полученной помощи', 'Rate received help')}
                      value={selected.rating}
                      onChange={(value) => {
                        act('rateHelp', { helpId: selected.id, value });
                        notify(
                          t(
                            'Оценка помощи сохранена. Рейтинг обновлён.',
                            'Help rating saved. The leaderboard has been updated.',
                          ),
                        );
                      }}
                      hint={
                        selected.rating
                          ? t(
                              `Твоя оценка: ${selected.rating} из 5 ★`,
                              `Your rating: ${selected.rating} out of 5 ★`,
                            )
                          : t('Оцени помощь от 1 до 5 звёзд', 'Rate the help from 1 to 5 stars')
                      }
                    />
                    <p className="muted">
                      {t(
                        'Новая оценка заменит предыдущую.',
                        'A new rating replaces the previous one.',
                      )}
                    </p>
                  </>
                ) : (
                  <p>
                    {t(
                      'Когда получишь помощь, выбери помощника в своём запросе и нажми «Помощь получена». После этого можно поставить оценку.',
                      'When you receive help, select the helper in your request and click "Help received". You can then rate it.',
                    )}
                  </p>
                )}
              </section>
              <section className="my-requests">
                <h2>{t('Мои запросы', 'My requests')}</h2>
                {own.length ? (
                  own.map((h) => <MyRequest key={h.id} request={h} />)
                ) : (
                  <Empty
                    title={t('Ещё нет запросов', 'No requests yet')}
                    description={t(
                      'Расскажи, с чем нужна помощь, в форме выше.',
                      'Tell us what you need help with in the form above.',
                    )}
                  />
                )}
              </section>
            </>
          )
        ) : (
          <>
            <div className="search-box study-search">
              <Icon name="search" />
              <input
                type="search"
                aria-label={t('Поиск по предмету', 'Search by subject')}
                placeholder={t('Поиск по предмету', 'Search by subject')}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setLimit(3);
                }}
              />
            </div>
            <div className="study-layout">
              <section className="help-cards" aria-label={t('Запросы на помощь', 'Help requests')}>
                {available.slice(0, limit).map((request) => {
                  const user = state.users.find((u) => u.id === request.authorId);
                  const offered = request.helpers.includes(me?.id);
                  return (
                    <article key={request.id} className="help-card panel">
                      <Link to={`/people/${user.id}`} className="person-heading">
                        <Avatar user={user} />
                        <h2>{fullName(user)}</h2>
                      </Link>
                      {me && (
                        <span className="shared-badge">
                          {t('Общие языки:', 'Shared languages:')}{' '}
                          {commonItems(me.languages, user.languages).length}
                        </span>
                      )}
                      <p className="student-details">
                        {user.direction}
                        <br />
                        {user.course} {t('курс', 'year')}
                      </p>
                      <p className="muted">{t('Нужна помощь с', 'Needs help with')}</p>
                      <span className="subject-tag">{request.subject}</span>
                      <p className="help-body">{request.body}</p>
                      <button
                        type="button"
                        className={`button ${offered ? 'button-outline' : 'button-blue'}`}
                        onClick={() => help(request)}
                      >
                        {offered ? t('Открыть диалог', 'Open conversation') : t('Помочь', 'Help')}
                      </button>
                      {offered && (
                        <p className="offered-note">
                          {t('Ты предложил помощь', 'You offered to help')}
                        </p>
                      )}
                    </article>
                  );
                })}
                {!available.length && (
                  <Empty
                    title={t('Запросов не найдено', 'No requests found')}
                    description={t(
                      'Попробуй другой предмет или загляни позже.',
                      'Try another subject or check again later.',
                    )}
                  />
                )}
                {available.length > limit && (
                  <button
                    className="button button-outline load-more"
                    onClick={() => setLimit((l) => l + 3)}
                    type="button"
                  >
                    {t('Показать ещё', 'Show more')}
                  </button>
                )}
              </section>
              <div className="rating-desktop">
                <RatingPanel />
              </div>
              <Link to="/questions?tab=rating" className="mobile-rating-link panel">
                {t('Рейтинг Медиума', 'Medium leaderboard')}
                <Icon name="arrow" />
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
