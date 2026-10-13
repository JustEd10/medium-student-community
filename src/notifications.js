// Recipient-only feed derived from existing records; no copies of private message bodies.
export function notificationsFor(state, userId) {
  const users = new Set(state.users.filter(u => u.deletedAt == null && u.bannedAt == null).map(u => u.id));
  if (!users.has(userId)) return [];
  const seen = new Set(state.notificationReads?.[userId] || []);
  const events = [];
  const push = (id, type, href, createdAt, subject = '', read = false) => events.push({ id, type, href, createdAt, subject: subject.slice(0, 180), read: read || seen.has(id) });
  const questions = new Map(state.questions.filter(q => q.deletedAt == null && users.has(q.authorId)).map(q => [q.id, q]));
  for (const answer of state.answers) {
    const q = questions.get(answer.questionId);
    if (q?.authorId === userId && answer.authorId !== userId && users.has(answer.authorId) && answer.deletedAt == null)
      push(`answer:${answer.id}`, 'answer', `/questions/${q.id}`, answer.createdAt, q.title);
  }
  for (const help of state.helpRequests) {
    if (help.deletedAt != null || !users.has(help.authorId)) continue;
    if (help.authorId === userId) for (const helper of help.helpers.filter(id => users.has(id))) {
      const at = help.helperOfferedAt?.[helper] || help.createdAt;
      push(`offer:${help.id}:${helper}:${at}`, 'offer', '/study?tab=my', at, help.subject);
    }
    if (help.helperId === userId && ['assigned', 'completed'].includes(help.status)) {
      const at = help.assignedAt || help.createdAt;
      push(`assigned:${help.id}:${at}`, 'assigned', '/study?tab=my', at, help.subject);
      if (help.status === 'completed') push(`completed:${help.id}:${help.completedAt || at}`, 'completed', '/study?tab=my', help.completedAt || at, help.subject);
    }
  }
  for (const chat of state.chats) {
    if (chat.deletedAt != null || !chat.members.includes(userId) || !chat.members.every(id => users.has(id))) continue;
    const latest = chat.messages.filter(m => m.deletedAt == null && m.senderId !== userId).at(-1);
    if (latest) push(`message:${latest.id}`, 'message', `/chats/${chat.id}`, latest.createdAt, '', latest.readAt != null);
  }
  return events.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, 100);
}
export function markNotificationsRead(state, actor, ids) {
  if (!state.users.some(u => u.id === actor && u.deletedAt == null && u.bannedAt == null)) throw new Error('AUTH_REQUIRED');
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) throw new Error('INVALID_DATA');
  const available = notificationsFor(state, actor).map(n => n.id);
  if (ids.some(id => !available.includes(id))) throw new Error('NOTIFICATION_NOT_ALLOWED');
  return { ...state, notificationReads: { ...state.notificationReads, [actor]: [...new Set([...(state.notificationReads?.[actor] || []), ...ids])].filter(id => available.includes(id)) } };
}
export function validNotificationReads(value, userIds) {
  if (value === undefined) return true;
  return value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([userId, ids]) =>
    userIds.has(userId) && Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === 'string' && id.length <= 300));
}
