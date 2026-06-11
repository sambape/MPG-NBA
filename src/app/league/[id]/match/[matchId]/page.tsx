import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { getMembers } from '@/lib/league';
import type { PlayerGamedayScore } from '@/lib/league';

function TeamSheet({ name, lines, score }: { name: string; lines: PlayerGamedayScore[]; score: number }) {
  return (
    <div className="card">
      <div className="flex-between">
        <h2 style={{ margin: 0 }}>{name}</h2>
        <span className="score-big">{score.toFixed(1)}</span>
      </div>
      <table>
        <thead>
          <tr><th>Joueur</th><th>Poste</th><th className="num">Matchs</th><th className="num">Pts fantasy</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <strong>{l.name}</strong> <span className="muted">{l.team_abbr}</span>
                {l.subbed_in && <span className="badge dim" style={{ marginLeft: 6 }}>entré du banc</span>}
                {l.boosted && <span className="badge gold" style={{ marginLeft: 6 }}>MVP ×1,5</span>}
              </td>
              <td><span className="pos-tag">{l.pos}</span></td>
              <td className="num">{l.games_played}</td>
              <td className="num"><strong>{l.fp.toFixed(1)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string; matchId: string }>;
}) {
  const { id, matchId } = await params;
  const leagueId = Number(id);
  const match = getDb()
    .prepare('SELECT * FROM h2h_matches WHERE id = ? AND league_id = ?')
    .get(Number(matchId), leagueId) as {
      gameday: number; home_member_id: number; away_member_id: number | null;
      home_score: number; away_score: number; played: number; details: string | null;
    } | undefined;
  if (!match) notFound();

  const members = getMembers(leagueId);
  const byId = new Map(members.map((m) => [m.id, m]));
  const home = byId.get(match.home_member_id);
  const away = match.away_member_id ? byId.get(match.away_member_id) : null;

  if (!match.played) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Journée {match.gameday}</h2>
        <p>
          {home?.team_name} vs {away?.team_name ?? '(exempt)'} — ce duel n’a pas encore été joué.
        </p>
        <Link href={`/league/${leagueId}/schedule`}>← Retour au calendrier</Link>
      </div>
    );
  }

  const details = JSON.parse(match.details ?? '{"home":[],"away":[]}') as {
    home: PlayerGamedayScore[];
    away: PlayerGamedayScore[];
  };

  return (
    <>
      <h2>
        Journée {match.gameday} : {home?.team_name} {match.home_score.toFixed(1)} —{' '}
        {match.away_score.toFixed(1)} {away?.team_name ?? '(exempt)'}
      </h2>
      <div className="grid2">
        <TeamSheet name={home?.team_name ?? '?'} lines={details.home} score={match.home_score} />
        {away && <TeamSheet name={away.team_name} lines={details.away} score={match.away_score} />}
      </div>
      <p><Link href={`/league/${leagueId}/schedule`}>← Retour au calendrier</Link></p>
    </>
  );
}
