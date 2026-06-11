import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getLeague, getMember, getRoster } from '@/lib/league';
import { transferAction } from '@/app/actions';
import TransferForm from '@/components/TransferForm';
import type { FreePlayer } from '@/components/DraftBoard';

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leagueId = Number(id);
  const user = (await currentUser())!;
  const league = getLeague(leagueId)!;
  if (league.status !== 'saison') redirect(`/league/${leagueId}`);

  const member = getMember(leagueId, user.id)!;
  const roster = getRoster(leagueId, member.id);
  const db = getDb();

  const freePlayers = db
    .prepare(
      `SELECT p.id, p.name, p.pos, p.rating, p.cote, t.abbr AS team_abbr
       FROM nba_players p JOIN nba_teams t ON t.id = p.team_id
       WHERE p.id NOT IN (SELECT player_id FROM rosters WHERE league_id = ?)
       ORDER BY p.rating DESC`
    )
    .all(leagueId) as FreePlayer[];

  const transfers = db
    .prepare(
      `SELECT tr.created_at, lm.team_name, po.name AS out_name, pi.name AS in_name
       FROM transfers tr
       JOIN league_members lm ON lm.id = tr.member_id
       JOIN nba_players po ON po.id = tr.out_player_id
       JOIN nba_players pi ON pi.id = tr.in_player_id
       WHERE tr.league_id = ? ORDER BY tr.id DESC LIMIT 20`
    )
    .all(leagueId) as { created_at: string; team_name: string; out_name: string; in_name: string }[];

  return (
    <div className="grid2">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Marché des transferts</h2>
        <p className="muted">
          Échange un joueur de ton effectif contre un agent libre du même poste. Budget :{' '}
          <strong>{member.budget} M</strong>.
        </p>
        <TransferForm
          roster={roster.map((r) => ({
            roster_id: r.roster_id, player_id: r.player_id, name: r.name,
            pos: r.pos, team_abbr: r.team_abbr, cote: r.cote,
          }))}
          freePlayers={freePlayers}
          budget={member.budget}
          action={transferAction.bind(null, leagueId)}
        />
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Derniers mouvements de la ligue</h2>
        {transfers.length === 0 ? (
          <p className="muted">Aucun transfert pour l’instant.</p>
        ) : (
          <table>
            <tbody>
              {transfers.map((t, i) => (
                <tr key={i}>
                  <td>
                    <strong>{t.team_name}</strong>
                    <div className="muted">⬅ {t.in_name} · ➡ {t.out_name}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
