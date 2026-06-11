import { redirect } from 'next/navigation';
import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getLeague, getMember, getMembers, getRoster, positionNeeds, slotsRemaining } from '@/lib/league';
import { POSITION_LABELS } from '@/lib/seed';
import { submitBidsAction, passRoundAction, forceResolveAction } from '@/app/actions';
import DraftBoard, { type FreePlayer } from '@/components/DraftBoard';

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leagueId = Number(id);
  const user = (await currentUser())!;
  const league = getLeague(leagueId)!;
  if (league.status === 'inscription') redirect(`/league/${leagueId}`);
  if (league.status !== 'mercato') redirect(`/league/${leagueId}/team`);

  const member = getMember(leagueId, user.id)!;
  const members = getMembers(leagueId);
  const myRoster = getRoster(leagueId, member.id);
  const needs = positionNeeds(leagueId, member.id);
  const mySlots = slotsRemaining(leagueId, member.id);
  const isCommissioner = league.commissioner_id === user.id;

  const freePlayers = getDb()
    .prepare(
      `SELECT p.id, p.name, p.pos, p.rating, p.cote, t.abbr AS team_abbr
       FROM nba_players p JOIN nba_teams t ON t.id = p.team_id
       WHERE p.id NOT IN (SELECT player_id FROM rosters WHERE league_id = ?)
       ORDER BY p.rating DESC`
    )
    .all(leagueId) as FreePlayer[];

  const boundSubmit = submitBidsAction.bind(null, leagueId);

  return (
    <>
      <div className="card flex-between">
        <div>
          <h2 style={{ margin: 0 }}>Mercato — tour {league.draft_round}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Objectif : 10 joueurs (2 par poste). Budget restant : <strong>{member.budget} M</strong>.
          </p>
        </div>
        <div>
          {members.map((m) => {
            const remaining = slotsRemaining(leagueId, m.id);
            const done = remaining === 0;
            return (
              <span key={m.id} className={`badge ${done ? 'green' : m.draft_ready ? 'gold' : 'dim'}`} style={{ marginLeft: 6 }}>
                {m.team_name} {done ? '✓ complet' : m.draft_ready ? '✓ prêt' : `${remaining} places`}
              </span>
            );
          })}
        </div>
      </div>

      {mySlots === 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ton effectif est complet ! 🎉</h2>
          <p className="muted">En attente des autres managers pour terminer le mercato.</p>
        </div>
      ) : member.draft_ready ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Enchères validées ✓</h2>
          <p className="muted">
            En attente des autres managers. Le tour sera résolu automatiquement quand tout le monde
            aura validé.
          </p>
        </div>
      ) : (
        <DraftBoard
          players={freePlayers}
          needs={needs}
          budget={member.budget}
          posLabels={POSITION_LABELS}
          submitAction={boundSubmit}
        />
      )}

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Mon effectif ({myRoster.length} / 10)</h2>
          {myRoster.length === 0 ? (
            <p className="muted">Aucun joueur recruté pour l’instant.</p>
          ) : (
            <table>
              <thead><tr><th>Joueur</th><th>Poste</th><th className="num">Payé</th></tr></thead>
              <tbody>
                {myRoster.map((r) => (
                  <tr key={r.roster_id}>
                    <td><strong>{r.name}</strong> <span className="muted">{r.team_abbr}</span></td>
                    <td><span className="pos-tag">{r.pos}</span></td>
                    <td className="num">{r.price} M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Actions</h2>
          {mySlots > 0 && !member.draft_ready && (
            <form action={passRoundAction.bind(null, leagueId)} style={{ marginBottom: 10 }}>
              <button className="btn secondary" type="submit">Passer ce tour sans enchérir</button>
            </form>
          )}
          {isCommissioner && (
            <form action={forceResolveAction.bind(null, leagueId)}>
              <button className="btn secondary" type="submit">⚡ Forcer la résolution du tour (commissaire)</button>
            </form>
          )}
          <p className="muted" style={{ marginTop: 12 }}>
            Si les effectifs ne sont pas complets au bout de 15 tours, ils sont complétés
            automatiquement avec les joueurs les moins chers, puis la saison démarre.
          </p>
          <p className="muted">
            <Link href={`/league/${leagueId}`}>← Retour à la ligue</Link>
          </p>
        </div>
      </div>
    </>
  );
}
