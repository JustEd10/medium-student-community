export const STORAGE_KEY = 'medium.frontend.v1';

export const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : 'Медиум');
export const initials = (user) =>
  user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : 'М';
export const uid = () =>
  globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const matches = (value, term) =>
  value.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase());
export const commonItems = (a = [], b = []) => a.filter((item) => b.includes(item));

const isStars = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

// ошибки — короткие коды (AUTH_REQUIRED, NOT_FOUND...), сервер отдаёт их клиенту как есть
function fail(code) {
  throw new Error(code);
}

function requireMember(state, actor) {
  if (!state.users.some((u) => u.id === actor)) fail('AUTH_REQUIRED');
}

// Все функции ниже не меняют state, а возвращают новый.

export function addQuestion(state, actor, input) {
  requireMember(state, actor);
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 8 || title.length > 180 || body.length > 2000 || !input.category)
    fail('INVALID_QUESTION');

  const question = {
    id: uid(),
    authorId: actor,
    title,
    body,
    category: input.category,
    createdAt: Date.now(),
  };
  return { state: { ...state, questions: [question, ...state.questions] }, id: question.id };
}

export function addAnswer(state, actor, questionId, body) {
  requireMember(state, actor);
  if (!state.questions.some((q) => q.id === questionId)) fail('NOT_FOUND');
  body = body.trim();
  if (body.length < 5 || body.length > 2000) fail('INVALID_ANSWER');

  const answer = {
    id: uid(),
    questionId,
    authorId: actor,
    body,
    rating: null,
    createdAt: Date.now(),
  };
  return { ...state, answers: [...state.answers, answer] };
}

export function rateAnswer(state, actor, answerId, value) {
  requireMember(state, actor);
  const answer = state.answers.find((a) => a.id === answerId);
  const question = state.questions.find((q) => q.id === answer?.questionId);
  if (!answer || !question) fail('NOT_FOUND');
  // оценивает только автор вопроса, и не сам себя
  if (question.authorId !== actor || answer.authorId === actor) fail('RATING_NOT_ALLOWED');
  if (!isStars(value)) fail('INVALID_RATING');
  return {
    ...state,
    answers: state.answers.map((a) => (a.id === answerId ? { ...a, rating: value } : a)),
  };
}

export function addHelp(state, actor, { subject, body }) {
  requireMember(state, actor);
  subject = subject.trim();
  body = body.trim();
  if (subject.length < 2 || subject.length > 80 || body.length < 10 || body.length > 2000)
    fail('INVALID_HELP');

  const help = {
    id: uid(),
    authorId: actor,
    subject,
    body,
    helpers: [],
    helperId: null,
    status: 'open',
    rating: null,
    createdAt: Date.now(),
  };
  return { ...state, helpRequests: [help, ...state.helpRequests] };
}

export function offerHelp(state, actor, helpId) {
  requireMember(state, actor);
  const help = state.helpRequests.find((h) => h.id === helpId);
  if (!help) fail('NOT_FOUND');
  if (help.authorId === actor || help.status !== 'open') fail('HELP_NOT_ALLOWED');
  return {
    ...state,
    helpRequests: state.helpRequests.map((h) =>
      h.id === helpId ? { ...h, helpers: [...new Set([...h.helpers, actor])] } : h,
    ),
  };
}

export function completeHelp(state, actor, helpId, helperId) {
  requireMember(state, actor);
  const help = state.helpRequests.find((h) => h.id === helpId);
  if (!help) fail('NOT_FOUND');
  if (help.authorId !== actor || help.status !== 'open') fail('HELP_NOT_ALLOWED');
  // выбрать можно только того, кто сам откликнулся
  if (helperId === actor || !help.helpers.includes(helperId)) fail('HELP_NOT_ALLOWED');
  return {
    ...state,
    helpRequests: state.helpRequests.map((h) =>
      h.id === helpId ? { ...h, helperId, status: 'completed' } : h,
    ),
  };
}

export function rateHelp(state, actor, helpId, value) {
  requireMember(state, actor);
  const help = state.helpRequests.find((h) => h.id === helpId);
  if (!help || help.authorId !== actor) fail('RATING_NOT_ALLOWED');
  if (help.status !== 'completed' || !help.helperId || help.helperId === actor)
    fail('RATING_NOT_ALLOWED');
  if (!isStars(value)) fail('INVALID_RATING');
  return {
    ...state,
    helpRequests: state.helpRequests.map((h) => (h.id === helpId ? { ...h, rating: value } : h)),
  };
}

// в рейтинг идут оценки и за ответы, и за помощь с учёбой
export function rankings(state) {
  const rows = state.users.map((user) => {
    const answerRatings = state.answers
      .filter((a) => a.authorId === user.id && a.rating != null)
      .map((a) => a.rating);
    const helpRatings = state.helpRequests
      .filter((h) => h.helperId === user.id && h.status === 'completed' && h.rating != null)
      .map((h) => h.rating);
    const values = [...answerRatings, ...helpRatings];
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      user,
      total,
      count: values.length,
      average: values.length ? total / values.length : 0,
    };
  });
  return rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.count - a.count ||
      fullName(a.user).localeCompare(fullName(b.user), 'ru'),
  );
}

export function openChat(state, actor, partner) {
  requireMember(state, actor);
  requireMember(state, partner);
  if (actor === partner) fail('CHAT_NOT_ALLOWED');
  const existing = state.chats.find(
    (c) => c.members.includes(actor) && c.members.includes(partner),
  );
  if (existing) return { state, id: existing.id };
  const chat = { id: uid(), members: [actor, partner], messages: [] };
  return { state: { ...state, chats: [...state.chats, chat] }, id: chat.id };
}

export function sendMessage(state, actor, chatId, body) {
  requireMember(state, actor);
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat?.members.includes(actor)) fail('CHAT_NOT_ALLOWED');
  body = body.trim();
  if (!body || body.length > 2000) fail('INVALID_MESSAGE');

  const message = { id: uid(), senderId: actor, body, createdAt: Date.now() };
  return {
    ...state,
    chats: state.chats.map((c) =>
      c.id === chatId ? { ...c, messages: [...c.messages, message] } : c,
    ),
  };
}

export function saveProfile(state, actor, profile) {
  requireMember(state, actor);
  const { firstName, lastName, direction, course, languages, interests, about, skills } = profile;
  if (!firstName.trim() || !lastName.trim() || !direction.trim() || !languages.length)
    fail('INVALID_PROFILE');
  const year = Number(course);
  if (!Number.isInteger(year) || year < 1 || year > 6) fail('INVALID_PROFILE');

  const updated = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    direction: direction.trim(),
    course: year,
    languages,
    interests,
    about: about.trim(),
    skills,
  };
  return {
    ...state,
    users: state.users.map((u) => (u.id === actor ? { ...u, ...updated } : u)),
  };
}

export async function passwordCredential(password, salt) {
  const bytes = salt ? Uint8Array.from(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  // обычные массивы вместо Uint8Array, чтобы без проблем лежало в JSON
  return { salt: Array.from(bytes), hash: Array.from(new Uint8Array(hash)) };
}

const TABLES = ['users', 'questions', 'answers', 'helpRequests', 'chats'];

const isText = (v) => typeof v === 'string';
const isTextList = (v) => Array.isArray(v) && v.every(isText);
const isRating = (v) => v === null || isStars(v);
const isByte = (n) => Number.isInteger(n) && n >= 0 && n <= 255;

function uniqueIds(rows) {
  return (
    rows.every((r) => r && isText(r.id)) && new Set(rows.map((r) => r.id)).size === rows.length
  );
}

function validCredential(c) {
  if (c === null) return true; // у демо-пользователей пароля нет
  if (!c) return false;
  const bytes = (a, size) => Array.isArray(a) && a.length === size && a.every(isByte);
  return bytes(c.salt, 16) && bytes(c.hash, 32);
}

// Проверка всего состояния целиком: и то, что прочитали с диска при старте,
// и то, что получилось после очередного действия. Битое не сохраняем.
export function validState(value) {
  if (value?.version !== 1) return false;
  if (!TABLES.every((k) => Array.isArray(value[k]))) return false;
  if (!TABLES.every((k) => uniqueIds(value[k]))) return false;
  if (!['ru', 'en'].includes(value.locale)) return false;

  const userIds = new Set(value.users.map((u) => u.id));
  const questionIds = new Set(value.questions.map((q) => q.id));
  const isUser = (id) => userIds.has(id);
  if (value.session !== null && !isUser(value.session)) return false;

  const userOk = (u) =>
    [u.firstName, u.lastName, u.direction, u.about, u.email].every(isText) &&
    Number.isInteger(u.course) &&
    u.course >= 1 &&
    u.course <= 6 &&
    [u.languages, u.interests, u.skills].every(isTextList) &&
    validCredential(u.credential);

  const questionOk = (q) =>
    isUser(q.authorId) &&
    [q.title, q.body, q.category].every(isText) &&
    Number.isFinite(q.createdAt);

  const answerOk = (a) =>
    isUser(a.authorId) &&
    questionIds.has(a.questionId) &&
    isText(a.body) &&
    isRating(a.rating) &&
    Number.isFinite(a.createdAt);

  const helpOk = (h) => {
    if (!isUser(h.authorId) || !isText(h.subject) || !isText(h.body)) return false;
    if (!isTextList(h.helpers)) return false;
    if (!h.helpers.every((id) => isUser(id) && id !== h.authorId)) return false;
    if (!Number.isFinite(h.createdAt)) return false;
    // пока заявка открыта, помощник не выбран и оценки нет
    if (h.status === 'open') return h.helperId === null && h.rating === null;
    if (h.status !== 'completed') return false;
    return h.helpers.includes(h.helperId) && h.helperId !== h.authorId && isRating(h.rating);
  };

  const chatOk = (c) => {
    if (!isTextList(c.members) || c.members.length !== 2) return false;
    if (c.members[0] === c.members[1] || !c.members.every(isUser)) return false;
    if (!Array.isArray(c.messages) || !uniqueIds(c.messages)) return false;
    return c.messages.every(
      (m) => c.members.includes(m.senderId) && isText(m.body) && Number.isFinite(m.createdAt),
    );
  };

  return (
    value.users.every(userOk) &&
    value.questions.every(questionOk) &&
    value.answers.every(answerOk) &&
    value.helpRequests.every(helpOk) &&
    value.chats.every(chatOk)
  );
}
