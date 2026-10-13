import React, { useEffect, useState } from 'react';
import { DeleteControl } from './AdminModeration';
import { ReportControl } from './Community';
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
  Tags,
} from './components';

function MyStudyOffer() {
  const { me, act, t } = useApp();
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setUntil(0);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [until]);
  if (!me) return null;
  const visible = me.studyHelpVisible !== false && me.skills.length > 0;
  async function changeVisibility(value) {
    if (busy) return;
    setBusy(true);
    if (await act('setStudyHelpVisibility', { visible: value })) {
      setUntil(value ? 0 : Date.now() + 5000);
      setRemaining(value ? 0 : 5);
    }
    setBusy(false);
  }
  return <>
    <section className="my-study-offer panel" aria-label={t('Моя анкета помощи', 'My study help profile')}>
      <h2>{t('Моя анкета помощи', 'My study help profile')}</h2>
      {visible ? <>
        <div className="my-study-offer-heading"><Avatar user={me} /><div><h3>{fullName(me)}</h3><p className="muted">{me.direction}</p></div></div>
        <p>{t('Могу помочь с', 'I can help with')}</p><Tags values={me.skills} kind="interest" />
        {me.about && <p>{me.about}</p>}
      </> : <p className="muted">{me.skills.length ? t('Анкета помощи убрана. Другие студенты не видят твои предметы для помощи.', 'Your study help profile is hidden from other students.') : t('Добавь предметы в профиле, чтобы предложить помощь.', 'Add subjects to your profile to offer help.')}</p>}
      <div className="my-study-offer-actions">
        <Link to="/profile" className="button button-outline">{t('Редактировать анкету', 'Edit profile')}</Link>
        {!!me.skills.length && <button type="button" className="button button-outline" disabled={busy} onClick={() => changeVisibility(!visible)}>
          {visible ? t('Убрать анкету', 'Remove study help profile') : t('Вернуть анкету', 'Restore study help profile')}
        </button>}
      </div>
    </section>
    {!!until && <div className="deletion-undo" role="status"><span>{t('Анкета помощи убрана', 'Study help profile removed')} · {remaining} {t('с', 's')}</span><button type="button" className="text-link" disabled={busy || Date.now() >= until} onClick={() => changeVisibility(true)}>{t('Отменить', 'Undo')}</button></div>}
  </>;
}

function RequestStatus({ request }) {
  const { t } = useApp();
  return <span className={`request-status status-${request.status}`}>{request.status === 'completed' ? t('Решено', 'Completed') : request.status === 'assigned' ? t('Помощник найден', 'Helper found') : t('Ищу помощь', 'Looking for help')}</span>;
}
function MyRequest({ request }) {
  const { state, act, t } = useApp();
  const [helper, setHelper] = useState(request.helpers[0] || '');
  const selectedHelper = request.helpers.includes(helper) ? helper : request.helpers[0];
  return <article className="my-request panel">
    <div className="request-heading"><h3>{request.subject}</h3><RequestStatus request={request} /></div>
    <p>{request.body}</p>
    <DeleteControl kind="help" id={request.id} label={t('Снять запрос', 'Withdraw request')} />
    {request.status === 'completed' ? <p className="completed-badge">{t('Помощь получена от', 'Help received from')} {fullName(state.users.find(u => u.id === request.helperId))}</p>
      : request.status === 'assigned' ? <>
        <p>{t('Помощник:', 'Helper:')} {fullName(state.users.find(u => u.id === request.helperId))}</p>
        <div className="request-actions"><button type="button" className="button button-green" onClick={() => act('completeHelp', { helpId: request.id, helperId: request.helperId })}>{t('Задача решена', 'Mark as completed')}</button>
        <button type="button" className="button button-outline" onClick={() => act('reopenHelp', { helpId: request.id })}>{t('Снова искать помощника', 'Find another helper')}</button></div>
      </> : request.helpers.length ? <>
        <Field label={t('Выбери помощника', 'Choose a helper')}><select value={selectedHelper} onChange={e => setHelper(e.target.value)}>{request.helpers.map(id => <option key={id} value={id}>{fullName(state.users.find(u => u.id === id))}</option>)}</select></Field>
        <button type="button" className="button button-green" onClick={() => act('selectHelp', { helpId: request.id, helperId: selectedHelper })}>{t('Выбрать помощника', 'Choose helper')}</button>
      </> : <p className="muted">{t('Откликов пока нет. Запрос виден в разделе «Могу помочь».', 'Waiting for offers. Your request is visible in “I can help”.')}</p>}
  </article>;
}
function MyStudyActivity() {
  const { state, me, t, act } = useApp();
  if (!me) return <LoginGate next="/study?tab=my" />;
  const own = state.helpRequests.filter(h => h.authorId === me.id);
  const offered = state.helpRequests.filter(h => h.authorId !== me.id && h.helpers.includes(me.id));
  return <div className="my-study-activity">
    <MyStudyOffer />
    <section className="my-requests"><h2>{t('Мои заявки', 'My requests')}</h2>{own.length ? own.map(h => <MyRequest key={h.id} request={h} />) : <Empty title={t('У тебя пока нет заявок', 'No requests yet')}><Link to="/study?tab=need" className="button button-blue">{t('Попросить помощь', 'Ask for help')}</Link></Empty>}</section>
    <section className="my-requests"><h2>{t('Мои отклики', 'My offers')}</h2>{offered.length ? offered.map(h => <article className="panel my-request" key={h.id}><div className="request-heading"><h3>{h.subject}</h3><RequestStatus request={h} /></div><p>{fullName(state.users.find(u => u.id === h.authorId))}</p><p>{h.body}</p>{h.status === 'assigned' && <p>{h.helperId === me.id ? t('Автор выбрал тебя помощником.', 'You were chosen as the helper.') : t('Автор выбрал другого помощника.', 'Another helper was chosen.')}</p>}<div className="request-actions"><button className="button button-outline" onClick={async () => { const chat = await act('openChat', { partner: h.authorId }); if (chat) go(`/chats/${chat.id}`); }}>{t('Открыть диалог', 'Open conversation')}</button>{h.status === 'open' && <button className="text-link" onClick={() => act('withdrawHelp', { helpId: h.id })}>{t('Отозвать отклик', 'Withdraw offer')}</button>}</div></article>) : <Empty title={t('Ты пока не предлагал помощь', 'No offers yet')}><Link to="/study" className="button button-outline">{t('Посмотреть заявки студентов', 'Browse student requests')}</Link></Empty>}</section>
  </div>;
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
  const mine = tab === 'my';
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
        activeIndex={mine ? 2 : need ? 1 : 0}
        items={[
          ['/study', t('Могу помочь', 'I can help')],
          ['/study?tab=need', t('Нужна помощь', 'I need help')],
          ['/study?tab=my', t('Мои заявки и отклики', 'My requests & offers')],
        ]}
      />
      <div key={mine ? 'my' : need ? 'need' : 'list'} className="tab-content">
        {mine ? <MyStudyActivity /> : need ? (
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
<p className="ai-privacy">{t('Публичный текст проверяет GigaChat. Подозрительные публикации передаются администратору без автоматического удаления.', 'GigaChat reviews public text and flags possible violations for an administrator without automatic deletion.')}</p>
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
            <MyStudyOffer />
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
                      <RequestStatus request={request} />
                      <p className="help-body">{request.body}</p>
                      {me && <ReportControl kind="help" id={request.id} />}
                      <button
                        type="button"
                        className={`button ${offered ? 'button-outline' : 'button-blue'}`}
                        onClick={() => help(request)}
                      >
                        {offered ? t('Открыть диалог', 'Open conversation') : t('Помочь', 'Help')}
                      </button>
                      {offered && (
                        <p className="offered-note">
                          <span>{t('Ты предложил помощь', 'You offered to help')}</span>
                          <button type="button" className="text-link" onClick={() => act('withdrawHelp', { helpId: request.id })}>{t('Отозвать отклик', 'Withdraw offer')}</button>
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
