import { db, commit } from './store.js';
import { createReviewWorker } from './ai-moderation.js';

export const reviewWorker = createReviewWorker({ read: () => db.state, write: state => commit({ ...db, state }) });
// Interrupted work requires explicit admin retry, avoiding repeated provider calls on restarts.
export function recoverReviews() {
  if (!Object.values(db.state.aiReviews || {}).some(r => r.status === 'pending')) return;
  commit({ ...db, state: { ...db.state, aiReviews: Object.fromEntries(Object.entries(db.state.aiReviews).map(([key, r]) =>
    [key, r.status === 'pending' ? { ...r, status: 'error', reason: 'Проверка прервана перезапуском. Повторите запрос.', updatedAt: Date.now() } : r])) } });
}
