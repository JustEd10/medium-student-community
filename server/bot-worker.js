import { db, commit } from './store.js';
import { provisionChatBots, recoverBotJobs, createBotWorker } from './chat-bots.js';
import { loadChatBotConfig } from './chat-provider.js';

export const botWorker = createBotWorker({ read: () => db.state, write: state => commit({ ...db, state }) });
export function initializeChatBots() {
  let next = db.state;
  if (loadChatBotConfig().enabled) next = provisionChatBots(next);
  if (next.chats.some(c => c.botJob?.status === 'pending')) next = recoverBotJobs(next);
  if (next !== db.state) commit({ ...db, state: next });
}
