import Link from 'next/link';
import AuthForm from '@/components/AuthForm';
import { registerAction } from '../actions';

export default function RegisterPage() {
  return (
    <>
      <h1>Inscription</h1>
      <p className="subtitle">Crée ton compte pour monter ta ligue fantasy NBA entre amis.</p>
      <div className="card form-narrow">
        <AuthForm
          action={registerAction}
          fields={[
            { name: 'username', label: 'Pseudo' },
            { name: 'password', label: 'Mot de passe', type: 'password' },
          ]}
          submitLabel="Créer mon compte"
        />
        <p className="muted">
          Déjà inscrit ? <Link href="/login">Connecte-toi</Link>
        </p>
      </div>
    </>
  );
}
