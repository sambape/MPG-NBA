import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { currentUser } from '@/lib/auth';
import { logoutAction } from './actions';

export const metadata: Metadata = {
  title: 'Mon Petit Parquet — Fantasy NBA',
  description: 'La ligue fantasy NBA entre amis : mercato aux enchères, compos, duels chaque semaine.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="fr">
      <body>
        <nav className="topnav">
          <Link href="/" className="logo">
            🏀 Mon Petit <span>Parquet</span>
          </Link>
          <div className="links">
            {user && <Link href="/">Mes ligues</Link>}
            <Link href="/nba">Matchs NBA</Link>
            <Link href="/players">Joueurs</Link>
          </div>
          <div className="user">
            {user ? (
              <>
                <span>{user.username}</span>
                <form action={logoutAction}>
                  <button className="btn secondary small" type="submit">Déconnexion</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">Connexion</Link>
                <Link href="/register" className="btn small">S’inscrire</Link>
              </>
            )}
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
