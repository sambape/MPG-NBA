import Link from 'next/link';
import AuthForm from '@/components/AuthForm';
import { loginAction } from '../actions';

export default function LoginPage() {
  return (
    <>
      <h1>Connexion</h1>
      <p className="subtitle">Retrouve tes ligues et tes équipes.</p>
      <div className="card form-narrow">
        <AuthForm
          action={loginAction}
          fields={[
            { name: 'username', label: 'Pseudo' },
            { name: 'password', label: 'Mot de passe', type: 'password' },
          ]}
          submitLabel="Se connecter"
        />
        <p className="muted">
          Pas encore de compte ? <Link href="/register">Inscris-toi</Link>
        </p>
      </div>
    </>
  );
}
