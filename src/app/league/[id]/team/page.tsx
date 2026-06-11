import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getLeague, getMember, getRoster } from '@/lib/league';
import { POSITION_LABELS } from '@/lib/seed';
import { setLineupAction, activateBoostAction } from '@/app/actions';
import LineupForm, { type LineupPlayer } from '@/components/LineupForm';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leagueId = Number(id);
  const user = (await currentUser())!;
  const league = getLeague(leagueId)!;
  if (league.status === 'inscription' || league.status === 'mercato') redirect(`/league/${leagueId}`);

  const member = getMember(leagueId, user.id)!;
  const roster = getRoster(leagueId, member.id);
  const db = getDb();

  // Moyenne de points fantasy par journée jouée, pour aider à choisir la compo.
  const avgStmt = db.prepare(
    `SELECT COALESCE(SUM(sl.fp), 0) AS total, COUNT(DISTINCT g.gameday) AS days
     FROM stat_lines sl JOIN nba_games g ON g.id = sl.game_id
     WHERE sl.player_id = ? AND g.played = 1`
  );
  const lineupRoster: LineupPlayer[] = roster.map((r) => {
    const s = avgStmt.get(r.player_id) as { total: number; days: number };
    return { ...r, avg_fp: s.days > 0 ? s.total / s.days : 0 };
  });

  const locked = league.status !== 'saison';
  const boostActive = member.boost_gameday === league.current_gameday && league.status === 'saison';

  return (
    <div className="grid2">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ma compo — {member.team_name}</h2>
        <p className="muted">
          Ton cinq majeur marque les points de ton équipe. Si un titulaire ne joue aucun match de la
          semaine, son remplaçant de banc au même poste entre automatiquement.
        </p>
        <LineupForm
          roster={lineupRoster}
          posLabels={POSITION_LABELS}
          action={setLineupAction.bind(null, leagueId)}
          locked={locked}
        />
      </div>
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>🚀 Boost MVP</h2>
          <p className="muted">
            Active le boost pour que ton meilleur titulaire compte <strong>×1,5</strong> sur la
            journée en cours. {member.boosts_remaining} utilisation(s) restante(s) cette saison.
          </p>
          {boostActive ? (
            <p className="success">Boost activé pour la journée {league.current_gameday} ✓</p>
          ) : league.status === 'saison' ? (
            <form action={activateBoostAction.bind(null, leagueId)}>
              <button className="btn" type="submit" disabled={member.boosts_remaining <= 0}>
                Activer pour la journée {league.current_gameday}
              </button>
            </form>
          ) : (
            <p className="muted">La saison est terminée.</p>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>💰 Budget</h2>
          <p>
            <span className="score-big">{member.budget} M</span>
            <span className="muted"> restants pour le marché des transferts</span>
          </p>
        </div>
      </div>
    </div>
  );
}
