import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const Context = createContext(null);
const TOKEN_KEY = 'medium.token';
const LOCALE_KEY = 'medium.locale';
const empty = { users: [], questions: [], answers: [], helpRequests: [], chats: [] };

export function go(path) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}
export function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const url = new URL(hash.replace(/^#/, '') || '/', 'https://medium.local');
  return { path: url.pathname, search: url.searchParams };
}
const read = key => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* работает до перезагрузки */ }
};

async function request(path, { method = 'GET', body, token, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const res = await fetch(`/api/app${path}`, {
      method, cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error || 'SERVER_ERROR'), { status: res.status });
    if (!data || typeof data !== 'object') throw Object.assign(new Error('SERVER_ERROR'), { status: 502 });
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function AppProvider({ children }) {
  const [data, setData] = useState({ ...empty, me: null });
  const [locale, setLocale] = useState(() => read(LOCALE_KEY) === 'en' ? 'en' : 'ru');
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState('');
  const token = useRef(read(TOKEN_KEY));
  const revision = useRef(0);
  const sessionGeneration = useRef(0);
  const poll = useRef(null);
  const authBusy = useRef(false);
  const mutations = useRef(0);
  const queue = useRef(Promise.resolve());
  const inFlight = useRef(new Map());
  const t = (ru, en) => locale === 'en' ? (en ?? ru) : ru;

  const invalidate = useCallback(() => {
    revision.current += 1;
    poll.current?.controller.abort();
    poll.current = null;
  }, []);
  const apply = useCallback(result => {
    if (!result.state || !Object.keys(empty).every(key => Array.isArray(result.state[key]))) {
      throw Object.assign(new Error('SERVER_ERROR'), { status: 502 });
    }
    setData({ ...result.state, me: result.me });
    setOffline(false);
    setReady(true);
  }, []);
  const clearSession = useCallback((persist = true) => {
    token.current = null;
    if (persist) write(TOKEN_KEY, null);
    sessionGeneration.current += 1;
    invalidate();
    // Личная переписка и почта исчезают сразу, даже если сервер недоступен.
    setData(previous => ({ ...previous, me: null, chats: [], users: previous.users.map(user => ({ ...user, email: '' })) }));
  }, [invalidate]);
  const refresh = useCallback(async () => {
    if (authBusy.current || mutations.current) return;
    if (poll.current) return poll.current.promise;
    const version = revision.current;
    const requestedToken = token.current;
    const controller = new AbortController();
    const job = { controller };
    job.promise = (async () => {
      try {
        const result = await request('/state', { token: requestedToken, signal: controller.signal });
        if (version !== revision.current || requestedToken !== token.current) return;
        if (requestedToken && !result.me) clearSession();
        apply(result);
      } catch {
        if (version === revision.current && !controller.signal.aborted) setOffline(true);
      } finally {
        if (poll.current === job) poll.current = null;
      }
    })();
    poll.current = job;
    return job.promise;
  }, [apply, clearSession]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 6000);
    const onFocus = () => refresh();
    const onStorage = event => {
      if (event.key === TOKEN_KEY || event.key === null) {
        const nextToken = read(TOKEN_KEY);
        if (nextToken !== token.current) {
          clearSession(false);
          token.current = nextToken;
          refresh();
        }
      }
      if (event.key === LOCALE_KEY) setLocale(read(LOCALE_KEY) === 'en' ? 'en' : 'ru');
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      invalidate();
    };
  }, [refresh, clearSession, invalidate]);
  useEffect(() => { document.documentElement.lang = locale; write(LOCALE_KEY, locale); }, [locale]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  function act(type, args = {}) {
    const requestedToken = token.current;
    const generation = sessionGeneration.current;
    const key = JSON.stringify([generation, type, args]);
    if (inFlight.current.has(key)) return inFlight.current.get(key);
    mutations.current += 1;
    const task = queue.current.then(async () => {
      if (generation !== sessionGeneration.current || requestedToken !== token.current) return null;
      invalidate();
      try {
        const result = await request('/act', { method: 'POST', body: { type, args }, token: requestedToken });
        if (generation !== sessionGeneration.current || requestedToken !== token.current) return null;
        apply(result);
        return { id: result.id };
      } catch (err) {
        if (generation !== sessionGeneration.current || requestedToken !== token.current) return null;
        if (err.status === 401) {
          clearSession();
          setNotice(t('Сессия закончилась. Войди снова.', 'Your session has expired. Sign in again.'));
        } else if (!err.status) {
          setOffline(true);
          setNotice(t('Нет связи с сервером. Попробуй ещё раз.', 'Cannot reach the server. Try again.'));
        } else if (err.message === 'STORAGE_UNAVAILABLE') {
          setNotice(t('Сервер не смог сохранить данные. Попробуй позже.', 'The server could not save your data. Try again later.'));
        } else {
          setNotice(t('Не удалось сохранить. Проверь данные и попробуй снова.', 'Could not save. Check the data and try again.'));
        }
        return null;
      }
    }).finally(() => {
      mutations.current -= 1;
      inFlight.current.delete(key);
    });
    queue.current = task.catch(() => {});
    inFlight.current.set(key, task);
    return task;
  }
  async function auth(kind, body) {
    if (authBusy.current) return 'AUTH_BUSY';
    authBusy.current = true;
    sessionGeneration.current += 1;
    invalidate();
    try {
      const result = await request(`/auth/${kind}`, { method: 'POST', body });
      if (typeof result.token !== 'string' || !result.me) throw new Error('SERVER_ERROR');
      apply(result);
      token.current = result.token;
      write(TOKEN_KEY, result.token);
      return null;
    } catch (err) {
      return err.status ? err.message : 'NETWORK';
    } finally {
      authBusy.current = false;
    }
  }
  async function logout() {
    if (authBusy.current) return;
    const previousToken = token.current;
    authBusy.current = true;
    clearSession();
    try {
      await request('/auth/logout', { method: 'POST', body: {}, token: previousToken });
    } catch { /* локальный выход уже выполнен */ }
    finally { authBusy.current = false; }
    await refresh();
  }
  const state = { ...data, session: data.me, locale };
  const me = data.users.find(user => user.id === data.me) || null;
  const toggleLocale = () => setLocale(value => value === 'ru' ? 'en' : 'ru');
  const requireUser = (next = '/profile') => {
    if (me) return true;
    setNotice(t('Войди, чтобы продолжить.', 'Sign in to continue.'));
    go(`/login?next=${encodeURIComponent(next)}`);
    return false;
  };
  return <Context.Provider value={{ state, toggleLocale, me, locale, t, notify: setNotice, offline, ready, retry: refresh, notice, requireUser, act, auth, logout }}>{children}</Context.Provider>;
}
export const useApp = () => useContext(Context);
