import { uid } from './domain.js';

const tables = { user: 'users', question: 'questions', answer: 'answers', help: 'helpRequests' };
const active = value => value && value.deletedAt == null;
const fail = code => { throw new Error(code); };
const actorUser = (state, actor) => {
  const user = state.users.find(u => u.id === actor && active(u) && u.bannedAt == null);
  if (!user) fail('AUTH_REQUIRED');
  return user;
};
function target(state, kind, id) {
  if (kind === 'message') {
    for (const chat of state.chats) {
      const message = chat.messages.find(m => m.id === id);
      if (message) return { item: message, chat };
    }
  } else if (Object.hasOwn(tables, kind)) {
    const item = state[tables[kind]].find(item => item.id === id);
    if (item) return { item };
  }
  fail('NOT_FOUND');
}
export function deleteContent(state, actor, kind, id) {
  const user = actorUser(state, actor);
  const { item, chat } = target(state, kind, id);
  if (!active(item)) fail('NOT_FOUND');
  const administrator = user.role === 'admin';
  if (kind === 'user') {
    if (!administrator || item.role === 'admin' || item.id === actor) fail('DELETE_NOT_ALLOWED');
  } else if (!administrator && (item.authorId || item.senderId) !== actor) fail('DELETE_NOT_ALLOWED');
  if (chat && !administrator && (!active(chat) || !chat.members.includes(actor))) fail('DELETE_NOT_ALLOWED');
  const deletion = { deletedAt: Date.now(), deletedBy: actor, deletionId: uid() };
  const mark = (value, root = false) => active(value)
    ? { ...value, ...deletion, ...(root ? { deleteRoot: true } : {}) } : value;
  const removedQuestions = new Set(state.questions.filter(q =>
    (kind === 'question' && q.id === id) || (kind === 'user' && q.authorId === id),
  ).map(q => q.id));
  return {
    ...state,
    users: state.users.map(u => kind === 'user' && u.id === id ? mark(u, true) : u),
    questions: state.questions.map(q => removedQuestions.has(q.id) ? mark(q, kind === 'question') : q),
    answers: state.answers.map(a => (kind === 'answer' && a.id === id) ||
      removedQuestions.has(a.questionId) || (kind === 'user' && a.authorId === id)
      ? mark(a, kind === 'answer' && a.id === id) : a),
    helpRequests: state.helpRequests.map(h => (kind === 'help' && h.id === id) ||
      (kind === 'user' && h.authorId === id) ? mark(h, kind === 'help') : h),
    chats: state.chats.map(c => {
      if (kind === 'user' && c.members.includes(id)) return mark(c);
      if (kind !== 'message' || c.id !== chat.id) return c;
      return { ...c, messages: c.messages.map(m => m.id === id ? mark(m, true) : m) };
    }),
  };
}
export function restoreContent(state, actor, kind, id) {
  const user = actorUser(state, actor);
  const { item, chat } = target(state, kind, id);
  if (active(item) || !item.deleteRoot) fail('NOT_FOUND');
  if (user.role !== 'admin' && item.deletedBy !== actor) fail('RESTORE_NOT_ALLOWED');
  if (item.deletedBy !== actor || Date.now() - item.deletedAt >= 5000) fail('RESTORE_NOT_ALLOWED');
  const owner = item.authorId || item.senderId;
  if ((owner && !state.users.some(u => u.id === owner && active(u))) ||
    (kind === 'answer' && !state.questions.some(q => q.id === item.questionId && active(q))) ||
    (chat && !active(chat))) fail('RELATED_CONTENT_DELETED');
  const restore = value => {
    if (value.deletionId !== item.deletionId) return value;
    const { deletedAt, deletedBy, deletionId, deleteRoot, ...rest } = value;
    return rest;
  };
  return { ...state,
    ...Object.fromEntries(Object.values(tables).map(table => [table, state[table].map(restore)])),
    chats: state.chats.map(chat => ({ ...restore(chat), messages: chat.messages.map(restore) })),
  };
}
export function deletedContent(state, actor) {
  const user = actorUser(state, actor);
  const result = [];
  const add = (item, kind, title) => {
    if (item.deleteRoot && (user.role === 'admin' || item.deletedBy === actor))
      result.push({ kind, id: item.id, title, deletedAt: item.deletedAt });
  };
  for (const [kind, table] of Object.entries(tables))
    for (const item of state[table]) add(item, kind,
      kind === 'user' ? `${item.firstName} ${item.lastName}` : item.title || item.subject || item.body);
  for (const chat of state.chats) for (const message of chat.messages) add(message, 'message', message.body);
  return result.sort((a, b) => b.deletedAt - a.deletedAt);
}

export function setUserBan(state, actor, id, banned) {
  const admin = actorUser(state, actor);
  const user = state.users.find(u => u.id === id && active(u));
  if (admin.role !== 'admin' || id === actor || user?.role === 'admin') fail('BAN_NOT_ALLOWED');
  if (!user) fail('NOT_FOUND');
  if (typeof banned !== 'boolean') fail('INVALID_DATA');
  return { ...state, users: state.users.map(u => {
    if (u.id !== id) return u;
    const { bannedAt, bannedBy, ...rest } = u;
    return banned ? { ...rest, bannedAt: Date.now(), bannedBy: actor } : rest;
  }) };
}
