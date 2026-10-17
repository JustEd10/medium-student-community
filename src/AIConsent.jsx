import React, { useId } from 'react';
import { useApp } from './context';

export default function AIConsent({ checked, onChange, disabled = false, error, required = false }) {
  const { t, state } = useApp();
  const id = useId();
  const provider = state.chatAI?.provider === 'groq' ? 'Groq' : 'Gemini';
  return <div className="registration-consent">
    <label className="check-line" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        disabled={disabled} required={required} aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${id}-description${error ? ` ${id}-error` : ''}`} />
      <span>{t('Мне есть 18 лет. Разрешаю передавать сообщения AI-собеседникам через', 'I am 18 or older. I agree to send messages to AI language partners through')} {provider} {t('для ответа.', 'for replies.')}</span>
    </label>
    <details id={`${id}-description`}>
      <summary>{t('Что это означает', 'What this means')}</summary>
      <p>{t('Ли, Пьер и Диего — вымышленные AI-собеседники для языковой практики. Ответы могут содержать ошибки. Во внешний сервис передаются только последние сообщения открытого диалога. Не отправляй личные данные.', 'Li, Pierre and Diego are fictional AI language partners. Replies may contain mistakes. Only recent messages in the open conversation go to the external service. Do not send personal data.')}</p>
      {provider === 'Gemini' && <p>{t('В бесплатном API Google может использовать текст для улучшения моделей.', 'Google may use free API text to improve its models.')}</p>}
      <p>{t('Согласие можно отозвать в своём профиле.', 'You can withdraw consent in your profile.')}</p>
    </details>
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}
