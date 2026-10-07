import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useApp, go } from './context';
import { commonItems, fullName, initials, rankings } from './domain';

// CSS masks resolve relative URLs against the stylesheet, which lives in /assets/ after a build.
export const asset = name => new URL(`${import.meta.env.BASE_URL}assets/${name}`, document.baseURI).href;
export function Icon({ name, className = '' }) { return <span aria-hidden="true" className={`icon ${className}`} style={{ '--icon-url': `url("${asset(`${name}.svg`)}")` }} />; }
export function Link({ to, children, className = '', ...props }) { return <a href={`#${to}`} className={className} {...props}>{children}</a>; }
export function Avatar({ user, large = false }) { return <span aria-hidden="true" className={`avatar color-${user?.color ?? 0} ${large ? 'avatar-large' : ''}`}>{initials(user)}</span>; }
export function Tags({ values, kind = 'language' }) { const { t } = useApp(); return <ul className={`tags tags-${kind}`} aria-label={kind === 'language' ? t('Языки','Languages') : t('Интересы','Interests')}>{values.map(value => <li key={value}>{value}</li>)}</ul>; }
export function PageTitle({ title, description }) { return <div className="page-title"><h1 tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>; }
export function Empty({ title, description, children }) { return <div className="empty-state panel"><h2>{title}</h2>{description && <p>{description}</p>}{children}</div>; }
export function Field({ label, error, id, children, className = '', endAdornment }) {
  const autoId = useId(); const controlId = id || autoId;
  return <div className={`field ${className}`}><label htmlFor={controlId}>{label}</label>{endAdornment ? <div className="field-control">{React.cloneElement(children, { id: controlId, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${controlId}-error` : children.props['aria-describedby'] })}{endAdornment}</div> : React.cloneElement(children, { id: controlId, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${controlId}-error` : children.props['aria-describedby'] })}{error && <p id={`${controlId}-error`} className="field-error">{error}</p>}</div>;
}
export function FormErrors({ errors }) { const { t } = useApp(); const list = Object.values(errors).filter(Boolean); return list.length ? <div className="form-errors" role="alert"><strong>{t('Проверь поля формы', 'Please check the form')}</strong><ul>{list.map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null; }
export function Dialog({ open, onClose, onAfterClose, navigationKey = '', title, children, className = '' }) {
  const dialog = useRef(null); const closeTimer = useRef(null); const shownRoute = useRef(navigationKey); const titleId = useId(); const { t } = useApp(); const [phase,setPhase] = useState('closed');
  useLayoutEffect(() => {
    clearTimeout(closeTimer.current);
    const navigated = shownRoute.current !== navigationKey;
    shownRoute.current = navigationKey;
    if (navigated && dialog.current.open) {
      // A new page must be immediately interactive, including its form fields.
      dialog.current.close(); setPhase('closed');
    } else if (open) {
      setPhase('open');
      if (!dialog.current.open) dialog.current.showModal();
    } else if (dialog.current.open) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dialog.current.close(); setPhase('closed');
      } else {
        setPhase('closing');
        // Keep native focus containment until the short exit finishes.
        closeTimer.current = setTimeout(() => { dialog.current?.close(); setPhase('closed'); }, 160);
      }
    }
    return () => clearTimeout(closeTimer.current);
  }, [open,navigationKey]);
  function nativeClose() {
    // A queued native close event can arrive after showModal() reopened the menu.
    if (dialog.current.open) return;
    onClose(); onAfterClose?.();
  }
  return <dialog ref={dialog} data-phase={phase} className={`dialog ${className}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClose={nativeClose} onClick={e => { if (e.target === e.currentTarget && (e.clientX < e.currentTarget.getBoundingClientRect().left || e.clientX > e.currentTarget.getBoundingClientRect().right || e.clientY < e.currentTarget.getBoundingClientRect().top || e.clientY > e.currentTarget.getBoundingClientRect().bottom)) onClose(); }}><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button close-button" onClick={onClose} aria-label={t('Закрыть', 'Close')}>×</button></div>{children}</dialog>;
}
export function SegmentedNav({ items, activeIndex, label, className = '' }) {
  return <nav className={`segmented motion-segmented ${className}`} aria-label={label} style={{ '--active-index': activeIndex }}><span className="segment-indicator" aria-hidden="true" />{items.map(([to,text],index) => <Link to={to} key={to} className={index === activeIndex ? 'active' : ''} aria-current={index === activeIndex ? 'page' : undefined}><span>{text}</span></Link>)}</nav>;
}
export function Header({ path, onMenu }) {
  const { me, t, locale, setState } = useApp();
  const links = [['/',t('Главная','Home')],['/people',t('Знакомства','Meet people')],['/study',t('Помощь с учёбой','Study help')],['/questions',t('Вопрос-ответ','Questions')]];
  return <header className="site-header"><div className="header-inner"><Link to="/" className="brand" aria-label={t('Медиум: главная','Medium: home')}><img src={asset('brand-hero.png')} width="52" height="35" alt="" /><span>{t('МЕДИУМ','MEDIUM')}</span></Link><button className="language-button" type="button" aria-label={t('Switch interface to English','Переключить интерфейс на русский')} onClick={() => setState(s => ({ ...s, locale: locale === 'ru' ? 'en' : 'ru' }))}>RU/EN</button><nav className="desktop-nav" aria-label={t('Основная навигация','Main navigation')}>{links.map(([url,label]) => <Link to={url} key={url} className={path === url || (url !== '/' && path.startsWith(url)) ? 'active' : ''} aria-current={path === url || (url !== '/' && path.startsWith(url)) ? 'page' : undefined}>{label}</Link>)}</nav><div className="header-actions">{me ? <Link to="/profile" className="profile-link" aria-label={t('Твой профиль','Your profile')}><Avatar user={me} /></Link> : <Link to="/register" className="button button-header" aria-label={t('Присоединиться','Join us')}><span className="header-join-full" aria-hidden="true">{t('Присоединиться','Join us')}</span><span className="header-join-short" aria-hidden="true">{t('Начать','Join')}</span></Link>}<button className="icon-button menu-toggle" type="button" aria-label={t('Открыть меню','Open menu')} aria-haspopup="dialog" onClick={onMenu}><Icon name="menu" /></button></div></div></header>;
}
export function BottomNav({ path }) {
  const { t } = useApp();
  const items = [['/','home',t('Главная','Home')],['/people','people',t('Знакомства','People')],['/study','book',t('Учёба','Study')],['/questions','chat',t('Вопросы','Questions')]];
  return <nav className="bottom-nav" aria-label={t('Навигация на телефоне','Mobile navigation')}>{items.map(([to,icon,label]) => { const active = to === '/' ? path === '/' : path.startsWith(to); return <Link to={to} key={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></Link>; })}</nav>;
}
export function MenuContent({ onClose = () => {} }) {
  const { t, me, locale, setState, notify } = useApp();
  const links = [['/',t('Главная','Home')],['/people',t('Знакомства','Meet people')],['/study',t('Помощь с учёбой','Study help')],['/questions',t('Вопрос-ответ','Questions & answers')],['/chats',t('Общение','Messages')],['/profile',t('Профиль','Profile')]];
  return <div className="menu-content"><nav aria-label={t('Все разделы','All sections')}>{links.map(([url,label]) => <Link to={url} key={url} onClick={onClose}>{label}<Icon name="arrow" /></Link>)}</nav><button type="button" className="menu-language" onClick={() => setState(s => ({ ...s, locale: locale === 'ru' ? 'en' : 'ru' }))}>{t('Язык интерфейса','Interface language')}<span>{locale === 'ru' ? 'Русский → English' : 'English → Русский'}</span></button>{me ? <button className="button button-outline" type="button" onClick={() => { setState(s => ({ ...s, session: null })); onClose(); notify(t('Ты вышел из аккаунта.','You have signed out.')); go('/'); }}>{t('Выйти','Sign out')}</button> : <Link to="/login" className="button" onClick={onClose}>{t('Войти','Sign in')}</Link>}</div>;
}
export function LoginGate({ next, title }) { const { t } = useApp(); return <><PageTitle title={title || t('Войди в Медиум','Sign in to Medium')} /><Empty title={t('Продолжим после входа','Sign in to continue')} description={t('Создай профиль, чтобы знакомиться, писать сообщения и помогать другим.','Create a profile to meet people, send messages and help others.')}><Link to={`/login?next=${encodeURIComponent(next)}`} className="button">{t('Войти','Sign in')}</Link><Link to={`/register?next=${encodeURIComponent(next)}`} className="text-link">{t('Создать аккаунт','Create account')}</Link></Empty></>; }
export function StudentCard({ user }) {
  const { me, t } = useApp(); const shared = commonItems(me?.languages, user.languages).length;
  return <article className="student-card panel"><Link to={`/people/${user.id}`} className="person-heading"><Avatar user={user} /><h2>{fullName(user)}</h2></Link>{me && <span className="shared-badge">{t('Общие языки:','Shared languages:')} {shared}</span>}<p className="student-details">{user.direction}<br />{user.course} {t('курс','year')}</p><Tags values={user.languages} /><Tags values={user.interests} kind="interest" /><p className="student-about">{user.about}</p><Link to={`/people/${user.id}`} className="button button-blue">{t('Познакомиться','Say hello')}</Link></article>;
}
export function Stars({ value, onChange, disabled, label, hint }) {
  const { t } = useApp(); const id = useId(); const refs = useRef([]); const [pulse,setPulse] = useState(0);
  function choose(next) { setPulse(next); onChange(next); }
  function keyDown(e, star) {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, star + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, star - 1);
    if (e.key === 'Home') next = 1;
    if (e.key === 'End') next = 5;
    if (next) { e.preventDefault(); refs.current[next - 1]?.focus(); choose(next); }
  }
  return <div className="stars-control"><div className="stars" role="radiogroup" aria-label={label} aria-describedby={`${id}-hint`}>{[1,2,3,4,5].map(n => <button ref={el => refs.current[n - 1] = el} key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${t('из 5 звёзд','out of 5 stars')}`} disabled={disabled} tabIndex={disabled ? -1 : (value === n || (!value && n === 1)) ? 0 : -1} className={`${n <= value ? 'star-selected' : ''} ${pulse === n && value === n ? 'star-confirming' : ''}`} onClick={() => choose(n)} onKeyDown={e => keyDown(e,n)} onAnimationEnd={() => setPulse(0)}><Icon name="star" /></button>)}</div><p id={`${id}-hint`} className={value ? 'rating-hint selected' : 'rating-hint'}>{hint || (value ? t(`Твоя оценка: ${value} из 5 ★`, `Your rating: ${value} out of 5 ★`) : t('Оцени ответ от 1 до 5 звёзд','Rate this answer from 1 to 5 stars'))}</p></div>;
}
export function RatingPanel({ full = false }) {
  const { state, t } = useApp(); const rows = rankings(state).slice(0,full ? 20 : 5);
  return <aside className="rating-panel panel" aria-labelledby="ranking-title"><h2 id="ranking-title">{t('Рейтинг','Leaderboard')}</h2><p className="rating-top">{full ? t('Помогаем друг другу','Helping each other') : t('Топ 5','Top 5')}</p><div className="rating-columns"><span>{t('Люди','People')}</span><span>{t('Количество звёзд','Stars received')}</span></div><ol className="rating-list">{rows.map(({user,total,count,average},i) => <li key={user.id}><Link to={`/people/${user.id}`}><Avatar user={user} /><span>{fullName(user)}{full && <small>{t(`Оценок: ${count} · средняя ${average.toFixed(1)}`,`Ratings: ${count} · average ${average.toFixed(1)}`)}</small>}</span></Link><span className="rating-score" aria-label={t(`${total} звёзд`,`${total} stars`)}>{total}<span aria-hidden="true"> ★</span></span></li>)}</ol><details className="rating-rules"><summary>{t('Как считается рейтинг?','How is the score calculated?')}</summary><p>{t('Рейтинг складывается из звёзд за ответы и завершённую помощь с учёбой. Оценку от 1 до 5 ставит автор вопроса или запроса. Если он меняет оценку, новая заменяет прежнюю. Свои ответы и помощь оценивать нельзя.','The score is the sum of stars for answers and completed study help. Only the question or request author can rate it from 1 to 5. A new rating replaces the previous one. You cannot rate yourself.')}</p></details></aside>;
}
