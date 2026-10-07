import React, { createContext, useContext, useEffect, useState } from 'react';
import { createInitialState } from './data';
import { STORAGE_KEY, validState } from './domain';

const Context = createContext(null);
export function go(path) { window.location.hash = path.startsWith('/') ? path : `/${path}`; }
export function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const changed = () => setHash(window.location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const url = new URL(hash.replace(/^#/, '') || '/', 'https://medium.local');
  return { path: url.pathname, search: url.searchParams };
}
export function AppProvider({ children }) {
  const [state, setState] = useState(() => {
    try { const cached = JSON.parse(localStorage.getItem(STORAGE_KEY)); return validState(cached) ? cached : createInitialState(); } catch { return createInitialState(); }
  });
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const locale = state.locale === 'en' ? 'en' : 'ru';
  const t = (ru, en) => locale === 'en' ? en ?? ru : ru;
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setStorageError(false); } catch { setStorageError(true); } }, [state]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    const sync = e => { if (e.key !== STORAGE_KEY || !e.newValue) return; try { const next = JSON.parse(e.newValue); if (validState(next)) setState(next); } catch { /* Keep the current usable state when a storage event is malformed. */ } };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  const me = state.users.find(u => u.id === state.session) || null;
  const requireUser = (next = '/profile') => { if (me) return true; setNotice(t('Войди, чтобы продолжить.', 'Sign in to continue.')); go(`/login?next=${encodeURIComponent(next)}`); return false; };
  return <Context.Provider value={{ state, setState, me, locale, t, notify: setNotice, storageError, notice, requireUser }}>{children}</Context.Provider>;
}
export const useApp = () => useContext(Context);
