import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp, useRoute } from './context';
import { BottomNav, Dialog, Empty, Header, Link, MenuContent, PageTitle } from './components';
import { Auth, Home } from './HomeAuth';
import { People, Person, Profile } from './PeopleProfile';
import { Question, Questions } from './Questions';
import { Study } from './Study';
import { Chats } from './Chats';

export default function App() {
  const route = useRoute(); const { t, notice, storageError, locale } = useApp(); const [menu,setMenu] = useState(false); const main = useRef(null); const menuRoute = useRef('');
  useLayoutEffect(() => { setMenu(false); window.scrollTo({ top: 0, behavior: 'instant' }); main.current?.querySelector('h1')?.focus({ preventScroll: true }); }, [route.path, route.search.toString()]);
  useEffect(() => { document.title = `${main.current?.querySelector('h1')?.textContent || t('Медиум','Medium')} · ${t('Медиум','Medium')}`; }, [route.path,locale]);
  let page;
  const parts = route.path.split('/').filter(Boolean);
  if (route.path === '/') page = <Home />;
  else if (route.path === '/login' || route.path === '/register') page = <Auth key={route.path} register={route.path === '/register'} next={route.search.get('next')} />;
  else if (route.path === '/profile') page = <Profile />;
  else if (route.path === '/people') page = <People />;
  else if (parts[0] === 'people' && parts.length === 2) page = <Person id={parts[1]} />;
  else if (route.path === '/questions') page = <Questions tab={route.search.get('tab')} />;
  else if (parts[0] === 'questions' && parts.length === 2) page = <Question key={parts[1]} id={parts[1]} />;
  else if (route.path === '/study') page = <Study tab={route.search.get('tab')} />;
  else if (route.path === '/chats' || parts[0] === 'chats' && parts.length === 2) page = <Chats id={parts[1]} />;
  else if (route.path === '/menu') page = <><PageTitle title={t('Меню','Menu')} /><section className="menu-page panel"><MenuContent /></section></>;
  else page = <><PageTitle title={t('Страница не найдена','Page not found')} /><Empty title={t('Открой главную страницу','Open the home page')}><Link to="/" className="button">{t('На главную','Go home')}</Link></Empty></>;
  return <><a className="skip-link" href="#main" onClick={e => { e.preventDefault(); main.current.focus(); }}>{t('Перейти к содержимому','Skip to content')}</a><Header path={route.path} onMenu={() => { menuRoute.current = window.location.hash; setMenu(true); }} /><main id="main" tabIndex={-1} ref={main} className={`site-main ${route.path === '/' ? 'home-main' : ''}`}>{storageError && <p role="alert" className="storage-error">{t('Браузер не разрешает сохранить данные. Изменения доступны до закрытия страницы.','This browser does not allow saving data. Changes are available until you close the page.')}</p>}{page}</main><footer className="site-footer"><p>{t('Медиум — твой круг возможностей','Medium — your circle of possibilities')}</p><Link to="/menu">{t('Все разделы','All sections')}</Link></footer><BottomNav path={route.path} /><Dialog open={menu} onClose={() => setMenu(false)} onAfterClose={() => { if (menuRoute.current !== window.location.hash) main.current?.querySelector('h1')?.focus({ preventScroll: true }); }} title={t('Меню','Menu')} className="menu-dialog"><MenuContent onClose={() => setMenu(false)} /></Dialog><div role="status" aria-live="polite" className={notice ? 'toast visible' : 'toast'}>{notice}</div></>;
}
