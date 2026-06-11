// Import des vrais matchs NBA depuis l'API publique (non documentée) d'ESPN.
// Gratuite, sans clé ni inscription : scoreboard + box scores complets.
//
// Usage : npx tsx scripts/sync-espn.ts <journée> <date-début YYYY-MM-DD>
//   ex. : npx tsx scripts/sync-espn.ts 1 2026-01-05
//
// Remplace les matchs simulés de la journée par les vrais matchs NBA de la
// semaine commençant à <date-début> (7 jours), avec les vraies feuilles de
// stats. Les joueurs sont rapprochés par nom ; « Jouer la journée » dans
// l'app utilisera alors ces stats réelles pour les duels de la ligue.

import { getDb } from '../src/lib/db';
import { fantasyPoints } from '../src/lib/sim';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// Abréviations ESPN → abréviations du jeu
const TEAM_MAP: Record<string, string> = {
  GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS',
};
const mapAbbr = (espn: string) => TEAM_MAP[espn] ?? espn;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (mpg-nba)' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${url}`);
  return res.json();
}

function stat(labels: string[], stats: string[], label: string): number {
  const i = labels.indexOf(label);
  if (i < 0 || !stats[i]) return 0;
  const v = parseInt(stats[i], 10);
  return Number.isFinite(v) ? v : 0;
}

async function main() {
  const [gdArg, dateArg] = process.argv.slice(2);
  const gameday = Number(gdArg);
  if (!Number.isInteger(gameday) || gameday < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg ?? '')) {
    console.error('Usage : npx tsx scripts/sync-espn.ts <journée> <date-début YYYY-MM-DD>');
    process.exit(1);
  }

  const db = getDb();
  const teamIdByAbbr = new Map<string, number>(
    (db.prepare('SELECT id, abbr FROM nba_teams').all() as { id: number; abbr: string }[]).map((t) => [t.abbr, t.id])
  );
  const playerByName = new Map<string, number>(
    (db.prepare('SELECT id, name FROM nba_players').all() as { id: number; name: string }[]).map((p) => [
      normalizeName(p.name), p.id,
    ])
  );

  // 1) Récupérer tous les matchs terminés de la semaine
  const start = new Date(`${dateArg}T12:00:00Z`);
  const events: { id: string; home: string; away: string; homeScore: number; awayScore: number }[] = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(start.getTime() + d * 86400000);
    const ymd = day.toISOString().slice(0, 10).replace(/-/g, '');
    const sb = await getJson(`${BASE}/scoreboard?dates=${ymd}`);
    for (const ev of sb.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp || !ev.status?.type?.completed) continue;
      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;
      events.push({
        id: ev.id,
        home: mapAbbr(home.team.abbreviation),
        away: mapAbbr(away.team.abbreviation),
        homeScore: Number(home.score),
        awayScore: Number(away.score),
      });
    }
    console.log(`  ${day.toISOString().slice(0, 10)} : ${events.length} matchs terminés cumulés`);
  }
  if (events.length === 0) {
    console.error('Aucun match terminé sur cette semaine — vérifie la date (saison NBA : octobre à juin).');
    process.exit(1);
  }

  // 2) Remplacer les matchs simulés de la journée par les vrais
  db.transaction(() => {
    const oldGames = db.prepare('SELECT id FROM nba_games WHERE gameday = ?').all(gameday) as { id: number }[];
    const delStats = db.prepare('DELETE FROM stat_lines WHERE game_id = ?');
    for (const g of oldGames) delStats.run(g.id);
    db.prepare('DELETE FROM nba_games WHERE gameday = ?').run(gameday);
  })();

  const insGame = db.prepare(
    'INSERT INTO nba_games (gameday, home_team_id, away_team_id, home_score, away_score, played) VALUES (?, ?, ?, ?, ?, 1)'
  );
  const insStat = db.prepare(
    `INSERT INTO stat_lines (game_id, player_id, minutes, pts, reb, ast, stl, blk, tov, fp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let inserted = 0;
  let matched = 0;
  let unmatched = 0;
  for (const ev of events) {
    const homeId = teamIdByAbbr.get(ev.home);
    const awayId = teamIdByAbbr.get(ev.away);
    if (!homeId || !awayId) {
      console.warn(`  ⚠ équipe inconnue : ${ev.away} @ ${ev.home} — match ignoré`);
      continue;
    }
    const gameId = Number(insGame.run(gameday, homeId, awayId, ev.homeScore, ev.awayScore).lastInsertRowid);
    inserted++;

    // 3) Box score du match
    const summary = await getJson(`${BASE}/summary?event=${ev.id}`);
    for (const teamBox of summary.boxscore?.players ?? []) {
      const block = teamBox.statistics?.[0];
      if (!block) continue;
      const labels: string[] = block.labels ?? block.names ?? [];
      for (const ath of block.athletes ?? []) {
        if (ath.didNotPlay) continue;
        const stats: string[] = ath.stats ?? [];
        if (stats.length === 0) continue;
        const playerId = playerByName.get(normalizeName(ath.athlete?.displayName ?? ''));
        if (!playerId) { unmatched++; continue; }
        const line = {
          pts: stat(labels, stats, 'PTS'),
          reb: stat(labels, stats, 'REB'),
          ast: stat(labels, stats, 'AST'),
          stl: stat(labels, stats, 'STL'),
          blk: stat(labels, stats, 'BLK'),
          tov: stat(labels, stats, 'TO'),
        };
        insStat.run(
          gameId, playerId, stat(labels, stats, 'MIN'),
          line.pts, line.reb, line.ast, line.stl, line.blk, line.tov,
          fantasyPoints(line)
        );
        matched++;
      }
    }
    console.log(`  ✓ ${ev.away} ${ev.awayScore} @ ${ev.home} ${ev.homeScore}`);
  }

  console.log(
    `\nJournée ${gameday} importée : ${inserted} matchs réels, ${matched} feuilles de stats rapprochées` +
    (unmatched ? ` (${unmatched} joueurs ESPN hors du pool du jeu, ignorés)` : '')
  );
  console.log('Dans l’app, « Jouer la journée » utilisera désormais ces stats réelles.');
}

main().catch((err) => {
  console.error('Erreur :', err.message ?? err);
  process.exit(1);
});
