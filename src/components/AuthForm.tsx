'use client';

import { useActionState } from 'react';

type Action = (prev: string | null, formData: FormData) => Promise<string | null>;

export interface Field {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
}

// Formulaire générique branché sur une action serveur qui renvoie un message
// d'erreur (ou null / 'OK' en cas de succès).
export default function AuthForm({
  action, fields, submitLabel, successMessage,
}: {
  action: Action;
  fields: Field[];
  submitLabel: string;
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="form-narrow">
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            defaultValue={f.defaultValue}
            required
          />
        </div>
      ))}
      {state && state !== 'OK' && <p className="error">{state}</p>}
      {state === 'OK' && successMessage && <p className="success">{successMessage}</p>}
      <p>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? '…' : submitLabel}
        </button>
      </p>
    </form>
  );
}
