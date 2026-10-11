import React, { useState } from 'react';
import { useApp, go } from './context';
import { asset, Field, FormErrors, Link, PageTitle } from './components';

export function Home() {
  const { t, me } = useApp();
  const destinations = [
    [
      '/people',
      'violet',
      t('Знакомства', 'Meet people'),
      t(
        'Выбери язык общения, затем найди студентов с близкими интересами.',
        'Choose a language to talk in, then find students with shared interests.',
      ),
    ],
    [
      '/questions',
      'sky',
      t('Вопрос-ответ', 'Questions & answers'),
      t(
        'Спроси о студенческом билете, расписании или жизни в кампусе.',
        'Ask about your student card, timetable or life on campus.',
      ),
    ],
    [
      '/study',
      'mint',
      t('Помощь с учёбой', 'Study help'),
      t(
        'Попроси объяснить сложную тему на языке, который ты понимаешь.',
        'Ask someone to explain a difficult topic in a language you understand.',
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
              <Link to={url}>{t('Перейти', 'Explore')}</Link>
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

export function Auth({ register, next }) {
  const { auth, t, notify } = useApp();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const target =
    next?.startsWith('/') && !next.startsWith('//') ? next : register ? '/profile' : '/people';
  const update = (e) => {
    const { name, value } = e.currentTarget;
    setValues((v) => ({ ...v, [name]: value }));
  };
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const email = values.email.trim().toLowerCase();
    const issues = {};
    if (register ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : !email)
      issues.email = register ? t('Проверь адрес почты.', 'Enter a valid email address.')
        : t('Укажи почту или логин.', 'Enter your email or username.');
    if (values.password.length < 8 || values.password.length > 128)
      issues.password = t(
        'Пароль должен содержать от 8 до 128 символов.',
        'Use a password between 8 and 128 characters.',
      );
    if (register && values.name.trim().split(/\s+/).length < 2)
      issues.name = t('Укажи имя и фамилию.', 'Enter your first and last names.');
    if (register && values.password !== values.confirm)
      issues.confirm = t('Пароли не совпадают.', 'Passwords do not match.');
    setErrors(issues);
    if (Object.keys(issues).length) return;
    setBusy(true);
    const code = register
      ? await auth('register', { name: values.name, email, password: values.password })
      : await auth('login', { identity: email, password: values.password });
    setBusy(false);
    if (code === 'EMAIL_TAKEN') {
      setErrors({
        email: t(
          'Аккаунт с этой почтой уже есть. Войди в него.',
          'An account with this email already exists. Sign in to it.',
        ),
      });
      return;
    }
    if (code === 'BAD_CREDENTIALS') {
      setErrors({ general: t('Данные для входа не подходят.', 'Sign-in details are incorrect.') });
      return;
    }
    if (code) {
      setErrors({
        general: t(
          'Не удалось связаться с сервером. Попробуй ещё раз.',
          'Could not reach the server. Try again.',
        ),
      });
      return;
    }
    notify(
      register
        ? t('Аккаунт создан. Заполни профиль.', 'Account created. Complete your profile.')
        : t('С возвращением!', 'Welcome back!'),
    );
    go(target);
  }
  return (
    <>
      <PageTitle
        title={register ? t('Регистрация', 'Create account') : t('Вход', 'Sign in')}
        description={
          register
            ? t(
                'Если ты приехал учиться из другой страны или хочешь помочь новым студентам, присоединяйся.',
                'Join if you have come from another country to study or want to help new students settle in.',
              )
            : undefined
        }
      />
      <section
        className="auth-panel panel"
        aria-label={t('Вход и регистрация', 'Sign in and registration')}
      >
        <nav className="segmented" aria-label={t('Выбор формы', 'Choose a form')}>
          <Link
            to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className={!register ? 'active' : ''}
            aria-current={!register ? 'page' : undefined}
          >
            {t('Вход', 'Sign in')}
          </Link>
          <Link
            to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className={register ? 'active' : ''}
            aria-current={register ? 'page' : undefined}
          >
            {t('Регистрация', 'Register')}
          </Link>
        </nav>
        <form onSubmit={submit} noValidate>
          <FormErrors errors={errors} />
          {register && (
            <Field label={t('Имя Фамилия', 'Full name')} error={errors.name}>
              <input
                name="name"
                autoComplete="name"
                value={values.name}
                onChange={update}
                maxLength={120}
                required
              />
            </Field>
          )}
          <Field label={register ? t('Почта', 'Email') : t('Почта или логин', 'Email or username')} error={errors.email}>
            <input
              name="email"
              type={register ? 'email' : 'text'}
              autoComplete={register ? 'email' : 'username'}
              value={values.email}
              onChange={update}
              maxLength={254}
              required
            />
          </Field>
          <Field label={t('Пароль', 'Password')} error={errors.password}>
            <input
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete={register ? 'new-password' : 'current-password'}
              value={values.password}
              onChange={update}
              minLength={8}
              maxLength={128}
              required
            />
          </Field>
          <label className="check-line">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            {t('Показать пароль', 'Show password')}
          </label>
          {register && (
            <Field label={t('Повтори пароль', 'Confirm password')} error={errors.confirm}>
              <input
                name="confirm"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={values.confirm}
                onChange={update}
                maxLength={128}
                required
              />
            </Field>
          )}
          <button type="submit" className="button button-full" disabled={busy}>
            {busy
              ? t('Подожди…', 'Please wait…')
              : register
                ? t('Создать аккаунт', 'Create account')
                : t('Войти', 'Sign in')}
          </button>
        </form>
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
