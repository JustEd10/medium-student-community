const limits = { office: 180, building: 180, hours: 500, contact: 500, checkedAt: 10, source: 1500 };
export function validateKnowledgeOverride(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(limits, k))) throw new Error('INVALID_DIRECTORY');
  const result = {};
  for (const [key, max] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('INVALID_DIRECTORY');
    result[key] = input[key].trim();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.checkedAt) || !Number.isFinite(Date.parse(result.checkedAt)) || new Date(result.checkedAt).toISOString().slice(0, 10) !== result.checkedAt || result.checkedAt > new Date().toISOString().slice(0, 10)) throw new Error('INVALID_DIRECTORY');
  let url;
  try { url = new URL(result.source); } catch { throw new Error('INVALID_DIRECTORY'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_DIRECTORY');
  return result;
}
export function loadKnowledge(baseChunks, state = {}) {
  return baseChunks.map(chunk => {
    const raw = Object.hasOwn(state.knowledgeOverrides || {}, chunk.id) ? state.knowledgeOverrides[chunk.id] : null;
    if (!raw) return { ...chunk };
    let entry;
    try { entry = validateKnowledgeOverride(raw); } catch { return { ...chunk }; }
    const details = `Кабинет: ${entry.office || 'не указан'}. Корпус: ${entry.building || 'не указан'}. Часы приёма: ${entry.hours || 'не указаны'}. Контакты: ${entry.contact || 'не указаны'}.`;
    return { ...chunk, text: chunk.office ? `${chunk.title}. ${details}` : `${chunk.text} ${details}`, sourceNote: 'Контакты обновлены администратором Медиума; источник указан по ссылке.', url: entry.source, checkedAt: entry.checkedAt, directory: entry,
      ...(chunk.office ? { office: { ...chunk.office, answer: `${chunk.title}. ${details}` } } : {}) };
  });
}
