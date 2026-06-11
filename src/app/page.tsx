import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { getUserLeagues } from '@/lib/league';
import { GAMEDAYS } from '@/lib/sim';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  inscription: { label: 'Inscriptions ouvertes', cls: 'dim' },
  mercato: { label: 'Mercato en cours', cls: 'gold' },
  saison: { label: 'Saison en cours', cls: 'green' },
  terminee: { label: 'Saison terminée', cls: '' },
};

export default async function HomePage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="hero">
        <h1>🏀 Mon Petit Parquet</h1>
        <p>
          La ligue fantasy NBA entre amis, inspirée de Mon Petit Gazon : recrute tes joueurs au
          mercato aux enchères, aligne ton cinq majeur chaque semaine et affronte tes potes sur les
          vraies performances des stars NBA — tous les matchs, toutes les franchises.
        </p>
        <p>
          <Link href="/register" className="btn">Créer mon compte</Link>{' '}
          <Link href="/login" className="btn secondary">Connexion</Link>
        </p>
        <div className="grid2" style={{ marginTop: 40, textAlign: 'left' }}>
          <div className="card">
            <h2>💰 Mercato aux enchères</h2>
            <p className="muted">
              500 M de budget, des enchères à l’aveugle contre tes amis pour bâtir un effectif de
              10 joueurs : 2 meneurs, 2 arrières, 2 ailiers, 2 ailiers forts, 2 pivots.
            </p>
          </div>
          <div className="card">
            <h2>⚔️ Duels chaque semaine</h2>
            <p className="muted">
              Chaque journée, ton cinq majeur marque des points fantasy sur les vrais matchs NBA.
              Remplacements automatiques si un titulaire ne joue pas, boost MVP à dégainer au bon moment.
            </p>
          </div>
          <div className="card">
            <h2>📊 Tous les matchs NBA</h2>
            <p className="muted">
              Les 30 franchises, {GAMEDAYS} journées, toutes les feuilles de stats : points, rebonds,
              passes, interceptions, contres.
            </p>
          </div>
          <div className="card">
            <h2>🔁 Marché des transferts</h2>
            <p className="muted">
              En cours de saison, vends tes flops et recrute parmi les agents libres pour renforcer
              ton équipe avant la prochaine journée.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const leagues = getUserLeagues(user.id);
  return (
    <>
      <div className="flex-between">
        <div>
          <h1>Mes ligues</h1>
          <p className="subtitle">Salut {user.username} ! Prêt à dominer le parquet ?</p>
        </div>
        <div>
          <Link href="/league/new" className="btn">Créer une ligue</Link>{' '}
          <Link href="/league/join" className="btn secondary">Rejoindre</Link>
        </div>
      </div>
      {leagues.length === 0 ? (
        <div className="card">
          <p>
            Tu n’as pas encore de ligue. <Link href="/league/new">Crée la tienne</Link> et invite tes
            amis avec le code, ou <Link href="/league/join">rejoins une ligue existante</Link>.
          </p>
        </div>
      ) : (
        leagues.map((l) => {
          const status = STATUS_LABELS[l.status] ?? STATUS_LABELS.inscription;
          return (
            <Link key={l.id} href={`/league/${l.id}`}>
              <div className="card flex-between">
                <div>
                  <strong>{l.name}</strong>
                  <div className="muted">Ton équipe : {l.team_name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge ${status.cls}`}>{status.label}</span>
                  {l.status === 'saison' && (
                    <div className="muted">Journée {l.current_gameday} / {GAMEDAYS}</div>
                  )}
                </div>
              </div>
            </Link>
          );
        })
      )}
    </>
  );
}
