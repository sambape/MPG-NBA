import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { getLeague, getMembers, getStandings } from '@/lib/league';
import { getDb } from '@/lib/db';
import { startDraftAction, playGamedayAction } from '@/app/actions';
import { GAMEDAYS } from '@/lib/sim';

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leagueId = Number(id);
  const user = (await currentUser())!;
  const league = getLeague(leagueId)!;
  const members = getMembers(leagueId);
  const isCommissioner = league.commissioner_id === user.id;

  if (league.status === 'inscription') {
    return (
      <>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>En attente du coup d’envoi</h2>
          <p className="muted">
            Partage le code <span className="code-pill">{league.code}</span> avec tes amis pour
            qu’ils rejoignent la ligue ({members.length} / {league.max_members} équipes inscrites).
          </p>
          {isCommissioner ? (
            <form action={startDraftAction.bind(null, leagueId)}>
              <button className="btn" type="submit" disabled={members.length < 2}>
                🏀 Lancer le mercato
              </button>
              {members.length < 2 && <p className="muted">Il faut au moins 2 équipes.</p>}
            </form>
          ) : (
            <p className="muted">Le commissaire lancera le mercato quand tout le monde sera là.</p>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Équipes inscrites</h2>
          <table>
            <thead><tr><th>Équipe</th><th>Manager</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.team_name}</strong></td>
                  <td>{m.username}</td>
                  <td>{m.user_id === league.commissioner_id && <span className="badge gold">Commissaire</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (league.status === 'mercato') {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Mercato en cours — tour {league.draft_round}</h2>
        <p className="muted">Les enchères font rage. Va placer les tiennes !</p>
        <Link href={`/league/${leagueId}/draft`} className="btn">Aller au mercato</Link>
      </div>
    );
  }

  const standings = getStandings(leagueId);
  const db = getDb();
  const gd = league.status === 'terminee' ? GAMEDAYS : league.current_gameday;
  const matches = db
    .prepare('SELECT * FROM h2h_matches WHERE league_id = ? AND gameday = ? ORDER BY id')
    .all(leagueId, gd) as {
      id: number; home_member_id: number; away_member_id: number | null;
      home_score: number | null; away_score: number | null; played: number;
    }[];
  const byId = new Map(members.map((m) => [m.id, m]));
  const champion = league.status === 'terminee' ? standings[0] : null;

  return (
    <>
      {champion && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <h2 style={{ marginTop: 0 }}>🏆 Champion : {champion.member.team_name}</h2>
          <p className="muted">
            Bravo {champion.member.username} ! {champion.wins} victoires, {champion.pointsFor.toFixed(1)} points fantasy marqués.
          </p>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <div className="flex-between">
            <h2 style={{ margin: 0 }}>
              {league.status === 'terminee' ? `Dernière journée (J${gd})` : `Journée ${gd}`}
            </h2>
            {isCommissioner && league.status === 'saison' && (
              <form action={playGamedayAction.bind(null, leagueId)}>
                <button className="btn small" type="submit">▶ Jouer la journée</button>
              </form>
            )}
          </div>
          <table>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/league/${leagueId}/match/${m.id}`}>
                      {byId.get(m.home_member_id)?.team_name}
                      {' '}<strong>{m.played ? `${m.home_score} - ${m.away_score}` : 'vs'}</strong>{' '}
                      {m.away_member_id ? byId.get(m.away_member_id)?.team_name : '(exempt)'}
                    </Link>
                  </td>
                  <td className="num">
                    {m.played ? <span className="badge green">Joué</span> : <span className="badge dim">À venir</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isCommissioner && league.status === 'saison' && (
            <p className="muted">
              « Jouer la journée » importe les vrais matchs de la semaine NBA (via ESPN, simulation
              en secours) puis calcule les duels de la ligue.
            </p>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Classement</h2>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Équipe</th>
                <th className="num">V</th><th className="num">N</th><th className="num">D</th>
                <th className="num">Pts+</th><th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.member.id}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{row.member.team_name}</strong>
                    <div className="muted">{row.member.username}</div>
                  </td>
                  <td className="num">{row.wins}</td>
                  <td className="num">{row.draws}</td>
                  <td className="num">{row.losses}</td>
                  <td className="num">{row.pointsFor.toFixed(1)}</td>
                  <td className="num"><strong>{row.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
