export const STORAGE_KEY = 'medium.frontend.v1';
export const fullName = user => user ? `${user.firstName} ${user.lastName}`.trim() : 'Медиум';
export const initials = user => user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : 'М';
export const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const matches = (value, term) => value.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase());
export const commonItems = (a = [], b = []) => a.filter(item => b.includes(item));

function fail(code) { throw new Error(code); }
function requireMember(state, actor) { if (!state.users.some(u => u.id === actor)) fail('AUTH_REQUIRED'); }
export function addQuestion(state, actor, input) {
  requireMember(state, actor);
  const title = input.title.trim(), body = input.body.trim();
  if (title.length < 8 || title.length > 180 || body.length > 2000 || !input.category) fail('INVALID_QUESTION');
  const question = { id: uid(), authorId: actor, title, body, category: input.category, createdAt: Date.now() };
  return { state: { ...state, questions: [question, ...state.questions] }, id: question.id };
}
export function addAnswer(state, actor, questionId, body) {
  requireMember(state, actor);
  if (!state.questions.some(q => q.id === questionId)) fail('NOT_FOUND');
  body = body.trim();
  if (body.length < 5 || body.length > 2000) fail('INVALID_ANSWER');
  return { ...state, answers: [...state.answers, { id: uid(), questionId, authorId: actor, body, rating: null, createdAt: Date.now() }] };
}
export function rateAnswer(state, actor, answerId, value) {
  requireMember(state, actor);
  const answer = state.answers.find(a => a.id === answerId);
  const question = state.questions.find(q => q.id === answer?.questionId);
  if (!answer || !question) fail('NOT_FOUND');
  if (question.authorId !== actor || answer.authorId === actor) fail('RATING_NOT_ALLOWED');
  if (!Number.isInteger(value) || value < 1 || value > 5) fail('INVALID_RATING');
  return { ...state, answers: state.answers.map(a => a.id === answerId ? { ...a, rating: value } : a) };
}
export function addHelp(state, actor, { subject, body }) {
  requireMember(state, actor);
  subject = subject.trim(); body = body.trim();
  if (subject.length < 2 || subject.length > 80 || body.length < 10 || body.length > 2000) fail('INVALID_HELP');
  return { ...state, helpRequests: [{ id: uid(), authorId: actor, subject, body, helpers: [], helperId: null, status: 'open', rating: null, createdAt: Date.now() }, ...state.helpRequests] };
}
export function offerHelp(state, actor, helpId) {
  requireMember(state, actor);
  const help = state.helpRequests.find(h => h.id === helpId);
  if (!help) fail('NOT_FOUND');
  if (help.authorId === actor || help.status !== 'open') fail('HELP_NOT_ALLOWED');
  return { ...state, helpRequests: state.helpRequests.map(h => h.id === helpId ? { ...h, helpers: [...new Set([...h.helpers, actor])] } : h) };
}
export function completeHelp(state, actor, helpId, helperId) {
  requireMember(state, actor);
  const help = state.helpRequests.find(h => h.id === helpId);
  if (!help) fail('NOT_FOUND');
  if (help.authorId !== actor || !help.helpers.includes(helperId) || helperId === actor || help.status !== 'open') fail('HELP_NOT_ALLOWED');
  return { ...state, helpRequests: state.helpRequests.map(h => h.id === helpId ? { ...h, helperId, status: 'completed' } : h) };
}
export function rateHelp(state, actor, helpId, value) {
  requireMember(state, actor);
  const help = state.helpRequests.find(h => h.id === helpId);
  if (!help || help.authorId !== actor || help.status !== 'completed' || !help.helperId || help.helperId === actor) fail('RATING_NOT_ALLOWED');
  if (!Number.isInteger(value) || value < 1 || value > 5) fail('INVALID_RATING');
  return { ...state, helpRequests: state.helpRequests.map(h => h.id === helpId ? { ...h, rating: value } : h) };
}
export function rankings(state) {
  return state.users.map(user => {
    const values = [...state.answers.filter(a => a.authorId === user.id && a.rating != null).map(a => a.rating), ...state.helpRequests.filter(h => h.helperId === user.id && h.status === 'completed' && h.rating != null).map(h => h.rating)];
    const total = values.reduce((sum, value) => sum + value, 0);
    return { user, total, count: values.length, average: values.length ? total / values.length : 0 };
  }).sort((a, b) => b.total - a.total || b.count - a.count || fullName(a.user).localeCompare(fullName(b.user), 'ru'));
}
export function openChat(state, actor, partner) {
  requireMember(state, actor); requireMember(state, partner);
  if (actor === partner) fail('CHAT_NOT_ALLOWED');
  const existing = state.chats.find(c => c.members.includes(actor) && c.members.includes(partner));
  if (existing) return { state, id: existing.id };
  const chat = { id: uid(), members: [actor, partner], messages: [] };
  return { state: { ...state, chats: [...state.chats, chat] }, id: chat.id };
}
export function sendMessage(state, actor, chatId, body) {
  requireMember(state, actor);
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat?.members.includes(actor)) fail('CHAT_NOT_ALLOWED');
  body = body.trim();
  if (!body || body.length > 2000) fail('INVALID_MESSAGE');
  return { ...state, chats: state.chats.map(c => c.id === chatId ? { ...c, messages: [...c.messages, { id: uid(), senderId: actor, body, createdAt: Date.now() }] } : c) };
}
export function saveProfile(state, actor, profile) {
  requireMember(state, actor);
  const { firstName, lastName, direction, course, languages, interests, about, skills } = profile;
  if (!firstName.trim() || !lastName.trim() || !direction.trim() || !languages.length || !Number.isInteger(Number(course)) || Number(course) < 1 || Number(course) > 6) fail('INVALID_PROFILE');
  return { ...state, users: state.users.map(u => u.id === actor ? { ...u, firstName: firstName.trim(), lastName: lastName.trim(), direction: direction.trim(), course: Number(course), languages, interests, about: about.trim(), skills } : u) };
}
export async function passwordCredential(password, salt) {
  const bytes = salt ? Uint8Array.from(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytes, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { salt: Array.from(bytes), hash: Array.from(new Uint8Array(hash)) };
}
export function validState(value) {
  if (value?.version !== 1 || !['users','questions','answers','helpRequests','chats'].every(k => Array.isArray(value[k]))) return false;
  const text = v => typeof v === 'string';
  const list = v => Array.isArray(v) && v.every(text);
  const rating = v => v === null || Number.isInteger(v) && v >= 1 && v <= 5;
  const dated = v => Number.isFinite(v);
  const ids = new Set(value.users.map(u => u?.id));
  const questions = new Set(value.questions.map(q => q?.id));
  const unique = rows => rows.every(r => r && text(r.id)) && new Set(rows.map(r => r.id)).size === rows.length;
  const credential = v => v === null || v && [v.salt,v.hash].every(a => Array.isArray(a) && a.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) && v.salt.length === 16 && v.hash.length === 32;
  return ['users','questions','answers','helpRequests','chats'].every(k => unique(value[k]))
    && ['ru','en'].includes(value.locale) && (value.session === null || ids.has(value.session))
    && value.users.every(u => [u.firstName,u.lastName,u.direction,u.about,u.email].every(text) && Number.isInteger(u.course) && u.course >= 1 && u.course <= 6 && [u.languages,u.interests,u.skills].every(list) && credential(u.credential))
    && value.questions.every(q => ids.has(q.authorId) && [q.title,q.body,q.category].every(text) && dated(q.createdAt))
    && value.answers.every(a => ids.has(a.authorId) && questions.has(a.questionId) && text(a.body) && rating(a.rating) && dated(a.createdAt))
    && value.helpRequests.every(h => ids.has(h.authorId) && [h.subject,h.body].every(text) && list(h.helpers) && h.helpers.every(id => ids.has(id) && id !== h.authorId) && ['open','completed'].includes(h.status) && (h.status === 'open' ? h.helperId === null && h.rating === null : h.helpers.includes(h.helperId) && h.helperId !== h.authorId && rating(h.rating)) && dated(h.createdAt))
    && value.chats.every(c => list(c.members) && c.members.length === 2 && c.members[0] !== c.members[1] && c.members.every(id => ids.has(id)) && Array.isArray(c.messages) && unique(c.messages) && c.messages.every(m => c.members.includes(m.senderId) && text(m.body) && dated(m.createdAt)));
}
