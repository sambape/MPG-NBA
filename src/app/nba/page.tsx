import Link from 'next/link';
import { getDb } from '@/lib/db';
import { GAMEDAYS } from '@/lib/sim';

export default async function NbaPage({
  searchParams,
}: {
  searchParams: Promise<{ gd?: string }>;
}) {
  const db = getDb();
  const { gd: gdParam } = await searchParams;

  const lastPlayed = (db.prepare('SELECT MAX(gameday) AS gd FROM nba_games WHERE played = 1').get() as { gd: number | null }).gd ?? 1;
  const gd = Math.min(GAMEDAYS, Math.max(1, Number(gdParam ?? lastPlayed)));

  const games = db
    .prepare(
      `SELECT g.*, th.abbr AS home_abbr, th.city AS home_city, th.name AS home_name,
              ta.abbr AS away_abbr, ta.city AS away_city, ta.name AS away_name
       FROM nba_games g
       JOIN nba_teams th ON th.id = g.home_team_id
       JOIN nba_teams ta ON ta.id = g.away_team_id
       WHERE g.gameday = ? ORDER BY g.id`
    )
    .all(gd) as {
      id: number; played: number; source: string; home_score: number | null; away_score: number | null;
      home_abbr: string; home_city: string; home_name: string;
      away_abbr: string; away_city: string; away_name: string;
    }[];

  // Meilleurs joueurs de la journée (en points fantasy)
  const topPlayers = db
    .prepare(
      `SELECT p.name, p.pos, t.abbr, sl.pts, sl.reb, sl.ast, sl.stl, sl.blk, sl.fp
       FROM stat_lines sl
       JOIN nba_games g ON g.id = sl.game_id
       JOIN nba_players p ON p.id = sl.player_id
       JOIN nba_teams t ON t.id = p.team_id
       WHERE g.gameday = ?
       ORDER BY sl.fp DESC LIMIT 12`
    )
    .all(gd) as { name: string; pos: string; abbr: string; pts: number; reb: number; ast: number; stl: number; blk: number; fp: number }[];

  return (
    <>
      <h1>Matchs NBA</h1>
      <p className="subtitle">
        Tous les matchs des 30 franchises, semaine par semaine. Les journées se jouent au fur et à
        mesure que les ligues avancent.
      </p>
      <div className="flex" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {Array.from({ length: GAMEDAYS }, (_, i) => i + 1).map((g) => (
          <Link key={g} href={`/nba?gd=${g}`} className={`badge ${g === gd ? '' : 'dim'}`}>
            J{g}
          </Link>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="flex-between">
            <h2 style={{ margin: 0 }}>Journée {gd} — {games.length} matchs</h2>
            {games.some((g) => g.played) && (
              games.some((g) => g.source === 'espn')
                ? <span className="badge green">Stats réelles (ESPN)</span>
                : <span className="badge dim">Simulation</span>
            )}
          </div>
          <table>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td style={{ textAlign: 'right', width: '40%' }}>
                    {g.home_city} <strong>{g.home_name}</strong>
                  </td>
                  <td style={{ textAlign: 'center', width: '20%' }}>
                    {g.played ? <strong>{g.home_score} - {g.away_score}</strong> : <span className="muted">à venir</span>}
                  </td>
                  <td style={{ width: '40%' }}>
                    {g.away_city} <strong>{g.away_name}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Top performances de la journée</h2>
          {topPlayers.length === 0 ? (
            <p className="muted">Cette journée n’a pas encore été jouée.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Joueur</th><th className="num">Pts</th><th className="num">Reb</th><th className="num">Pd</th><th className="num">Fantasy</th></tr>
              </thead>
              <tbody>
                {topPlayers.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span className="pos-tag">{p.pos}</span> <strong>{p.name}</strong>{' '}
                      <span className="muted">{p.abbr}</span>
                    </td>
                    <td className="num">{p.pts}</td>
                    <td className="num">{p.reb}</td>
                    <td className="num">{p.ast}</td>
                    <td className="num"><strong>{p.fp.toFixed(1)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
