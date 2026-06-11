import Link from 'next/link';
import { getDb } from '@/lib/db';
import { getLeague, getMembers } from '@/lib/league';
import { GAMEDAYS } from '@/lib/sim';

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leagueId = Number(id);
  const league = getLeague(leagueId)!;
  const members = getMembers(leagueId);
  const byId = new Map(members.map((m) => [m.id, m]));

  const matches = getDb()
    .prepare('SELECT * FROM h2h_matches WHERE league_id = ? ORDER BY gameday, id')
    .all(leagueId) as {
      id: number; gameday: number; home_member_id: number; away_member_id: number | null;
      home_score: number | null; away_score: number | null; played: number;
    }[];

  const byGameday = new Map<number, typeof matches>();
  for (const m of matches) {
    if (!byGameday.has(m.gameday)) byGameday.set(m.gameday, []);
    byGameday.get(m.gameday)!.push(m);
  }

  return (
    <>
      <h2>Calendrier de la ligue — {GAMEDAYS} journées</h2>
      {[...byGameday.entries()].map(([gd, list]) => (
        <div key={gd} className="card">
          <div className="flex-between">
            <strong>Journée {gd}</strong>
            {gd === league.current_gameday && league.status === 'saison' && (
              <span className="badge">En cours</span>
            )}
          </div>
          <table>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: 'right', width: '40%' }}>{byId.get(m.home_member_id)?.team_name}</td>
                  <td style={{ textAlign: 'center', width: '20%' }}>
                    {m.played ? (
                      <Link href={`/league/${leagueId}/match/${m.id}`}>
                        <strong>{m.home_score} - {m.away_score}</strong>
                      </Link>
                    ) : (
                      <span className="muted">vs</span>
                    )}
                  </td>
                  <td style={{ width: '40%' }}>
                    {m.away_member_id ? byId.get(m.away_member_id)?.team_name : <span className="muted">Exempt</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
