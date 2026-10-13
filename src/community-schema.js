const string = (value, max = 2000) => typeof value === 'string' && value.length <= max;
export function validCommunityState(state, userIds) {
  for (const collection of ['reports', 'aiFeedback', 'appeals']) {
    const rows = state[collection];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || new Set(rows.map(r => r?.id)).size !== rows.length) return false;
    if (!rows.every(r => r && string(r.id, 120) && r.id && userIds.has(r.authorId) && string(r.key, 300) && Number.isFinite(r.createdAt) &&
      ['open', 'resolved', 'dismissed'].includes(r.status) && string(r.reason) &&
      (r.status === 'open' || (userIds.has(r.reviewerId) && Number.isFinite(r.reviewedAt) && string(r.decision))) &&
      (collection !== 'reports' || (['user', 'question', 'answer', 'help'].includes(r.kind) && string(r.targetId, 120))) &&
      (collection !== 'aiFeedback' || (string(r.question, 4000) && string(r.answer, 12000) && (r.questionId == null || string(r.questionId, 120)))))) return false;
  }
  if (state.moderationLog !== undefined && (!Array.isArray(state.moderationLog) || !state.moderationLog.every(r => r && string(r.id, 120) && userIds.has(r.actorId) && string(r.action, 120) && string(r.target, 300) && string(r.reason) && Number.isFinite(r.createdAt)))) return false;
  if (state.knowledgeOverrides !== undefined) {
    if (!state.knowledgeOverrides || typeof state.knowledgeOverrides !== 'object' || Array.isArray(state.knowledgeOverrides)) return false;
    for (const [id, entry] of Object.entries(state.knowledgeOverrides)) {
      if (!string(id, 120) || !entry || !['office', 'building', 'hours', 'contact', 'checkedAt', 'source'].every(key => string(entry[key], ({office:180,building:180,hours:500,contact:500,checkedAt:10,source:1500})[key]))) return false;
      try { const url = new URL(entry.source); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false; } catch { return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedAt) || !Number.isFinite(Date.parse(entry.checkedAt)) || new Date(entry.checkedAt).toISOString().slice(0,10) !== entry.checkedAt) return false;
    }
  }
  return true;
}
