import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './context';

export function MailStatusIcon({ phase }) {
  return <span className={`mail-status-icon ${phase}`} aria-hidden="true">
    {phase === 'verified' ? <svg viewBox="0 0 48 48"><path className="verified-stroke" d="m13 25 8 8 15-18" /></svg>
      : <svg viewBox="0 0 48 48"><rect x="8" y="13" width="32" height="24" rx="6" /><path d="m10 16 14 11 14-11" /><path className="mail-signal" d="M20 5h8M24 2v6" /></svg>}
  </span>;
}

export default function EmailCode({ value, onChange, onComplete, disabled, error }) {
  const { t } = useApp();
  const input = useRef(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => { if (!disabled) input.current?.focus({ preventScroll: true }); }, [disabled]);
  const change = value => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    onChange(digits); setSelected(Math.min(5, digits.length));
    if (digits.length === 6) onComplete(digits);
  };
  return <div className={`email-code-field${error ? ' invalid' : ''}`}>
    <label htmlFor="email-verification-code">{t('Код из письма', 'Code from the email')}</label>
    <div className="email-code-control" data-busy={disabled || undefined}>
      <div className="email-code-digits" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <span key={index} className={`email-code-cell${value[index] ? ' filled' : ''}${index === selected ? ' active' : ''}`}>
          <span key={`${index}-${value[index] || 'empty'}`}>{value[index] || '–'}</span>
        </span>)}
      </div>
      <input ref={input} id="email-verification-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} value={value} disabled={disabled}
        aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'code-hint code-error' : 'code-hint'}
        onSelect={e => setSelected(Math.min(5, e.currentTarget.selectionStart || 0))}
        onPaste={e => { const text = e.clipboardData.getData('text'); if (/\d/.test(text)) { e.preventDefault(); change(text); } }}
        onChange={e => change(e.target.value)} />
    </div>
    <p id="code-hint" className="field-hint">{t('6 цифр. Можно вставить код целиком.', '6 digits. You can paste the whole code.')}</p>
    {error && <p id="code-error" className="field-error" role="alert">{error}</p>}
  </div>;
}
