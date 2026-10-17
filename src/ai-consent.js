export const AI_CONSENT_VERSION = 1;
export const AI_PROVIDERS = ['gemini', 'groq'];
export function hasAIConsent(user, provider = 'gemini') {
  const c = user?.aiConsent;
  return !!c && c.version === AI_CONSENT_VERSION && c.provider === provider &&
    c.adultConfirmed === true && Number.isFinite(c.acceptedAt) && c.acceptedAt > 0;
}
export function validAIConsent(c) {
  return c === undefined || (c && AI_PROVIDERS.includes(c.provider) && c.version === AI_CONSENT_VERSION &&
    ((c.acceptedAt === null && c.adultConfirmed === false) || hasAIConsent({ aiConsent: c }, c.provider)));
}
export function hasChatConsent(user, chat, provider) {
  if (user?.aiConsent !== undefined) return hasAIConsent(user, provider);
  return !!chat?.botConsentAt && chat.botConsentProvider === provider;
}
