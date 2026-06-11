import { getDb } from '@/lib/db';
import { POSITION_LABELS } from '@/lib/seed';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; q?: string }>;
}) {
  const { pos, q } = await searchParams;
  const db = getDb();

  const filters: string[] = [];
  const args: (string | number)[] = [];
  if (pos && pos in POSITION_LABELS) {
    filters.push('p.pos = ?');
    args.push(pos);
  }
  if (q) {
    filters.push('(p.name LIKE ? OR t.abbr LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const players = db
    .prepare(
      `SELECT p.id, p.name, p.pos, p.rating, p.cote, t.abbr,
              COALESCE(AVG(sl.fp), 0) AS avg_fp,
              COALESCE(AVG(sl.pts), 0) AS avg_pts,
              COALESCE(AVG(sl.reb), 0) AS avg_reb,
              COALESCE(AVG(sl.ast), 0) AS avg_ast,
              COUNT(sl.id) AS games
       FROM nba_players p
       JOIN nba_teams t ON t.id = p.team_id
       LEFT JOIN stat_lines sl ON sl.player_id = p.id
       ${where}
       GROUP BY p.id
       ORDER BY avg_fp DESC, p.rating DESC`
    )
    .all(...args) as {
      id: number; name: string; pos: string; rating: number; cote: number; abbr: string;
      avg_fp: number; avg_pts: number; avg_reb: number; avg_ast: number; games: number;
    }[];

  return (
    <>
      <h1>Joueurs NBA</h1>
      <p className="subtitle">
        Les {players.length} joueurs du jeu, leurs cotes au mercato et leurs stats moyennes par match.
      </p>
      <form method="get" className="flex" style={{ marginBottom: 16, maxWidth: 560 }}>
        <select name="pos" defaultValue={pos ?? ''} style={{ width: 180 }}>
          <option value="">Tous les postes</option>
          {Object.entries(POSITION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input name="q" placeholder="Nom ou équipe…" defaultValue={q ?? ''} />
        <button className="btn" type="submit">Filtrer</button>
      </form>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Joueur</th><th>Poste</th><th className="num">Note</th><th className="num">Cote</th>
              <th className="num">MJ</th><th className="num">Pts</th><th className="num">Reb</th>
              <th className="num">Pd</th><th className="num">Fantasy/m</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong> <span className="muted">{p.abbr}</span></td>
                <td><span className="pos-tag">{p.pos}</span></td>
                <td className="num">{p.rating}</td>
                <td className="num">{p.cote} M</td>
                <td className="num">{p.games}</td>
                <td className="num">{p.avg_pts.toFixed(1)}</td>
                <td className="num">{p.avg_reb.toFixed(1)}</td>
                <td className="num">{p.avg_ast.toFixed(1)}</td>
                <td className="num"><strong>{p.avg_fp.toFixed(1)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
