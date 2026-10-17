import AIConsent from './AIConsent';
import EmailCode, { MailStatusIcon } from './EmailCode';
import './registration.css';
import React, { useEffect, useRef, useState } from 'react';
import { useApp, go } from './context';
import { asset, Field, FormErrors, Link, PageTitle } from './components';

export function Home() {
  const { t, me } = useApp();
  const destinations = [
    [
      '/people',
      'violet',
      t('Найти знакомых', 'Meet people'),
      t(
        'Выбери язык и интересы. Например: найди компанию для прогулки или практики русского.',
        'Choose a language and interests. Find company for a walk or to practise Russian.',
      ),
    ],
    [
      '/questions',
      'sky',
      t('Задать вопрос студентам', 'Ask students'),
      t(
        'Ответят другие студенты. Например: «Где поесть рядом с университетом?»',
        'Other students answer. For example: “Where can I eat near campus?”',
      ),
    ],
    [
      '/study',
      'mint',
      t('Получить помощь с учёбой', 'Get study help'),
      t(
        'Опубликуй заявку. Например: «Помогите разобраться с матрицами на английском».',
        'Post a request. For example: “Help me understand matrices in English”.',
      ),
    ],
  ];
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title" tabIndex={-1}>
            {t('Привет!', 'Hello!')}
            <br />
            {t('Это', 'This is')} <span className="gradient-text">{t('Медиум', 'Medium')}</span>
          </h1>
          <p className="hero-slogan">
            {t('Твой круг возможностей.', 'Your circle of possibilities.')}
          </p>
          <p className="hero-description">
            {t(
              'Медиум помогает иностранным студентам и студентам-мигрантам освоиться в университете.',
              'Medium helps international students and migrant students settle into university.',
            )}
            <br />
            {t(
              'Найди собеседника на понятном языке и спроси об учёбе или жизни в кампусе.',
              'Find someone who speaks your language and ask about studying or campus life.',
            )}
          </p>
          <Link to={me ? '/people' : '/register'} className="button button-hero">
            {me ? t('Найти людей', 'Find people') : t('Присоединиться', 'Join us')}
          </Link>
        </div>
        <img
          className="hero-logo"
          src={asset('brand-hero.png')}
          width="818"
          height="551"
          alt={t(
            'Медиум: сообщество, знания и общение',
            'Medium: community, knowledge and conversation',
          )}
        />
      </section>
      <section className="destinations" aria-labelledby="destinations-title">
        <h2 id="destinations-title">{t('Куда пойдём?', 'Where shall we go?')}</h2>
        <div className="destination-grid">
          {destinations.map(([url, color, title, body]) => (
            <article key={url} className={`destination-card ${color}`}>
              <h3>{title}</h3>
              <p>{body}</p>
              <Link to={url}>{title}<span aria-hidden="true"> →</span></Link>
            </article>
          ))}
        </div>
        <p className="community-note">
          {t(
            'Местные студенты тоже могут присоединиться: помочь иностранным студентам освоиться и попрактиковать другой язык.',
            'Local students can join too, help international students settle in and practise another language.',
          )}
        </p>
      </section>
    </>
  );
}

const PENDING_REGISTRATION = 'medium.registration.pending';
function savedChallenge() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_REGISTRATION));
    return value?.challengeId && value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}
function keepChallenge(value) {
  try { value ? sessionStorage.setItem(PENDING_REGISTRATION, JSON.stringify(value)) : sessionStorage.removeItem(PENDING_REGISTRATION); } catch {}
}

export function Auth({ register, next }) {
  const { auth, t, notify } = useApp();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('verify');
  const busyRef = useRef(false);
  const [show, setShow] = useState(false);
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState(() => register ? savedChallenge() : null);
  const [digits, setDigits] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [verified, setVerified] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const target = next?.startsWith('/') && !next.startsWith('//') ? next : register ? '/profile' : '/people';
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge?.challengeId]);
  useEffect(() => {
    if (!verified) return;
    const timer = setTimeout(() => { notify(t('Почта подтверждена. Аккаунт создан!', 'Email verified. Account created!')); go(target); }, 1100);
    return () => clearTimeout(timer);
  }, [verified, target]);
  const update = e => { const { name, value } = e.currentTarget; setValues(v => ({ ...v, [name]: value })); };
  const errorText = code => ({
    EMAIL_TAKEN: t('Аккаунт с этой почтой уже есть. Войди в него.', 'An account with this email already exists. Sign in.'),
    BAD_CREDENTIALS: t('Данные для входа не подходят.', 'Sign-in details are incorrect.'),
    MAIL_NOT_CONFIGURED: t('Подтверждение почты пока недоступно. Отправка писем ещё не подключена.', 'Email verification is not available yet. Email delivery has not been connected.'),
    MAIL_DELIVERY_FAILED: t('Не удалось отправить письмо. Повтори отправку, когда закончится отсчёт.', 'The email could not be sent. Try again after the countdown.'),
    CODE_INVALID: t('Код не подошёл. Проверь цифры в письме.', 'The code does not match. Check the digits in the email.'),
    CHALLENGE_EXPIRED: t('Срок действия кода истёк. Начни регистрацию заново.', 'The code has expired. Start registration again.'),
    ATTEMPTS_EXHAUSTED: t('Попытки закончились. Дождись истечения кода и начни заново.', 'No attempts left. Wait until the code expires, then start again.'),
    RATE_LIMITED: t('Слишком много попыток. Попробуй позже.', 'Too many attempts. Try again later.'),
    RESEND_COOLDOWN: t('До повторной отправки осталось немного времени.', 'Please wait before requesting another email.'),
    REGISTRATION_PENDING: t('Для этой почты уже запрошен код. Проверь письмо или подожди 10 минут.', 'A code has already been requested for this address. Check your email or wait 10 minutes.'),
    MAIL_PENDING: t('Письмо ещё отправляется. Попробуй немного позже.', 'The email is still being sent. Try again shortly.'),
    AI_CONSENT_REQUIRED: t('Подтверди возраст и согласие на общение с AI.', 'Confirm your age and consent to AI conversations.'),
  }[code] || t('Не удалось связаться с сервером. Попробуй ещё раз.', 'Could not reach the server. Try again.'));
  function acceptChallenge(result) {
    if (!result?.challenge) return false;
    const value = result.challenge;
    setChallenge(value); keepChallenge(value); setClock(Date.now()); setDigits('');
    setValues(v => ({ ...v, password: '', confirm: '' }));
    setDeliveryFailed(!!result.pendingError);
    setErrors(result.pendingError ? { general: errorText(result.pendingError) } : {});
    if (!result.pendingError) setSentCount(n => n + 1);
    return true;
  }
  async function submit(e) {
    e.preventDefault(); if (busyRef.current) return;
    const email = values.email.trim().toLowerCase(), issues = {};
    if (register ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : !email) issues.email = t('Проверь адрес почты или логин.', 'Check your email or username.');
    if (values.password.length < 8 || values.password.length > 128) issues.password = t('Пароль должен содержать от 8 до 128 символов.', 'Use a password between 8 and 128 characters.');
    if (register && values.name.trim().split(/\s+/).length < 2) issues.name = t('Укажи имя и фамилию.', 'Enter your first and last names.');
    if (register && values.password !== values.confirm) issues.confirm = t('Пароли не совпадают.', 'Passwords do not match.');
    if (register && !consent) issues.consent = t('Подтверди возраст и согласие.', 'Confirm your age and consent.');
    setErrors(issues); if (Object.keys(issues).length) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = register ? await auth('register', { name: values.name, email, password: values.password, aiConsent: consent }) : await auth('login', { identity: email, password: values.password });
      if (register && acceptChallenge(result)) return;
      if (result) { setErrors({ general: errorText(result) }); return; }
      notify(t('С возвращением!', 'Welcome back!')); go(target);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function verifyCode(value = digits) {
    if (busyRef.current || verified || !challenge) return;
    if (!/^\d{6}$/.test(value)) { setErrors({ code: t('Введи все 6 цифр.', 'Enter all 6 digits.') }); return; }
    busyRef.current = true; setOperation('verify'); setBusy(true); setErrors({});
    try {
      const result = await auth('register/verify', { challengeId: challenge.challengeId, code: value });
      if (result) { setErrors({ code: errorText(result) }); return; }
      keepChallenge(null); setVerified(true);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function resend() {
    if (busyRef.current || clock < challenge.resendAt || clock >= challenge.expiresAt) return;
    busyRef.current = true; setOperation('resend'); setBusy(true); setErrors({});
    try {
      const result = await auth('register/resend', { challengeId: challenge.challengeId });
      if (!acceptChallenge(result)) setErrors({ general: errorText(result) });
    } finally { busyRef.current = false; setBusy(false); }
  }
  if (register && challenge) {
    const wait = Math.max(0, Math.ceil((challenge.resendAt - clock) / 1000));
    const expired = clock >= challenge.expiresAt;
    return <>
      <PageTitle title={verified ? t('Почта подтверждена', 'Email verified') : t('Проверь почту', 'Check your email')} />
      <section className={`auth-panel panel email-verification ${verified ? 'complete' : ''}`} aria-label={t('Подтверждение почты', 'Email verification')}>
        <div key={`${sentCount}-${verified}`} className="mail-arrival"><MailStatusIcon phase={verified ? 'verified' : busy ? 'sending' : 'sent'} /></div>
        {verified ? <div className="email-success" role="status"><h2>{t('Готово!', 'All done!')}</h2><p>{t('Сейчас откроется твой профиль.', 'Your profile will open shortly.')}</p></div> : <>
          <h2>{deliveryFailed ? t('Письмо не отправлено', 'Email not sent') : t('Код подтверждения', 'Verification code')}</h2>
          <p className="email-destination">{challenge.localPreview ? t('Локальная проверка для', 'Local preview for') : deliveryFailed ? t('Повтори отправку на', 'Try sending again to') : t('Письмо с кодом отправлено на', 'A code has been sent to')} <strong>{challenge.email}</strong></p>
          {challenge.localPreview && <p className="field-hint" role="status">{t('Тестовый режим: настоящее письмо не отправляется.', 'Test mode: no real email is sent.')}</p>}
          <p className="field-hint">{t('Код действует 10 минут. Если письма нет, проверь папку «Спам».', 'The code is valid for 10 minutes. Check your spam folder if you cannot find the email.')}</p>
          <form onSubmit={e => { e.preventDefault(); verifyCode(); }} noValidate aria-busy={busy}>
            <FormErrors errors={errors.general ? { general: errors.general } : {}} />
            <EmailCode value={digits} onChange={value => { setDigits(value); setErrors({}); }} onComplete={verifyCode} disabled={busy || expired || deliveryFailed} error={errors.code} />
            {expired && <p role="alert" className="field-error">{errorText('CHALLENGE_EXPIRED')}</p>}
            <button type="submit" className="button button-full auth-progress-button" data-phase={busy ? 'loading' : 'idle'} disabled={busy || digits.length !== 6 || expired || deliveryFailed}>
              <span>{busy ? operation === 'resend' ? t('Отправляем код…', 'Sending code…') : t('Проверяем код…', 'Checking code…') : t('Подтвердить почту', 'Verify email')}</span>
            </button>
          </form>
          <div className="email-code-actions">
            <button type="button" className="text-link" disabled={busy || wait > 0 || expired} onClick={resend}>
              {wait > 0 ? t(`Отправить ещё раз через ${wait} с`, `Send again in ${wait}s`) : t('Отправить код ещё раз', 'Send the code again')}
            </button>
            <button type="button" className="text-link" disabled={busy} onClick={() => { keepChallenge(null); setChallenge(null); setErrors({}); setDigits(''); }}>{t('Изменить почту', 'Change email')}</button>
          </div>
        </>}
      </section>
    </>;
  }
  return <>
    <PageTitle title={register ? t('Регистрация', 'Create account') : t('Вход', 'Sign in')}
      description={register ? t('Присоединяйся к студентам и найди свой круг общения.', 'Join other students and find your circle.') : undefined} />
    <section className="auth-panel panel" aria-label={t('Вход и регистрация', 'Sign in and registration')}>
      <nav className="segmented" aria-label={t('Выбор формы', 'Choose a form')}>
        <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className={!register ? 'active' : ''} aria-current={!register ? 'page' : undefined}>{t('Вход', 'Sign in')}</Link>
        <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className={register ? 'active' : ''} aria-current={register ? 'page' : undefined}>{t('Регистрация', 'Register')}</Link>
      </nav>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <FormErrors errors={errors} />
        {!register && <p><Link to="/appeal">{t('Аккаунт заблокирован? Обжаловать решение', 'Account banned? Submit an appeal')}</Link></p>}
        {register && <Field label={t('Имя Фамилия', 'Full name')} error={errors.name}><input name="name" autoComplete="name" value={values.name} onChange={update} maxLength={120} required /></Field>}
        <Field label={register ? t('Почта', 'Email') : t('Почта или логин', 'Email or username')} error={errors.email}>
          <input name="email" type={register ? 'email' : 'text'} autoComplete={register ? 'email' : 'username'} value={values.email} onChange={update} maxLength={254} required />
        </Field>
        <Field label={t('Пароль', 'Password')} error={errors.password}><input name="password" type={show ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} value={values.password} onChange={update} minLength={8} maxLength={128} required /></Field>
        <label className="check-line"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />{t('Показать пароль', 'Show password')}</label>
        {register && <Field label={t('Повтори пароль', 'Confirm password')} error={errors.confirm}><input name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" value={values.confirm} onChange={update} maxLength={128} required /></Field>}
        {register && <>
          <AIConsent checked={consent} onChange={setConsent} required error={errors.consent} disabled={busy} />
          <p className="ai-privacy">{t('Имя и публичные поля анкеты проверяет GigaChat. Не указывай личные документы.', 'GigaChat reviews your name and public profile fields. Do not add personal documents.')}</p>
          <p className="field-hint">{t('Сначала отправим код на почту. Аккаунт появится после подтверждения.', 'We will email a code first. Your account is created after verification.')}</p>
        </>}
        <button type="submit" className="button button-full auth-progress-button" data-phase={busy ? 'loading' : 'idle'} disabled={busy}>
          <span>{busy ? register ? t('Отправляем код…', 'Sending code…') : t('Входим…', 'Signing in…') : register ? t('Получить код на почту', 'Email me a code') : t('Войти', 'Sign in')}</span>
        </button>
      </form>
      <p className="community-note">{t('Местные студенты тоже могут присоединиться: помочь иностранным студентам освоиться и попрактиковать другой язык.', 'Local students can join too, help international students settle in and practise another language.')}</p>
    </section>
  </>;
}
