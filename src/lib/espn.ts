// Source de données réelle : API publique d'ESPN (gratuite, sans clé).
// Chaque journée fantasy correspond à une vraie semaine NBA, ancrée sur
// NBA_SEASON_START (lundi de la semaine de la journée 1).

import { getDb } from './db';
import { fantasyPoints } from './sim';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const SEASON_START = process.env.NBA_SEASON_START || '2025-10-20'; // saison 2025-26
const FETCH_TIMEOUT_MS = 10000;

// Abréviations ESPN → abréviations du jeu
const TEAM_MAP: Record<string, string> = {
  GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS',
};
const mapAbbr = (espn: string) => TEAM_MAP[espn] ?? espn;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gamedayStartDate(gameday: number): string {
  const anchor = new Date(`${SEASON_START}T12:00:00Z`);
  return new Date(anchor.getTime() + (gameday - 1) * 7 * 86400000).toISOString().slice(0, 10);
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (mpg-nba)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${url}`);
  return res.json();
}

function stat(labels: string[], stats: string[], label: string): number {
  const i = labels.indexOf(label);
  if (i < 0 || !stats[i]) return 0;
  const v = parseInt(stats[i], 10);
  return Number.isFinite(v) ? v : 0;
}

export interface ImportResult {
  ok: boolean;
  games: number;
  statLines: number;
  unmatched: number;
  reason?: string;
}

// Importe la vraie semaine NBA correspondant à la journée. Remplace les
// matchs simulés de la journée. Renvoie ok:false (sans rien modifier) si
// l'API est injoignable ou si aucun match n'est terminé sur la semaine.
export async function importEspnWeek(gameday: number, startDate?: string): Promise<ImportResult> {
  const fail = (reason: string): ImportResult => ({ ok: false, games: 0, statLines: 0, unmatched: 0, reason });
  if (process.env.NBA_DATA_SOURCE === 'simulation') {
    return fail('NBA_DATA_SOURCE=simulation : import ESPN désactivé');
  }
  const start = new Date(`${startDate ?? gamedayStartDate(gameday)}T12:00:00Z`);

  // 1) Tous les matchs terminés de la semaine + leurs box scores (hors transaction)
  type Ev = { id: string; home: string; away: string; homeScore: number; awayScore: number; summary?: any };
  const events: Ev[] = [];
  try {
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
    }
    if (events.length === 0) {
      return fail(`aucun match NBA terminé sur la semaine du ${start.toISOString().slice(0, 10)}`);
    }
    for (const ev of events) {
      ev.summary = await getJson(`${BASE}/summary?event=${ev.id}`);
    }
  } catch (err) {
    return fail(`API ESPN injoignable (${err instanceof Error ? err.message : err})`);
  }

  // 2) Écriture en base, d'un bloc
  const db = getDb();
  const teamIdByAbbr = new Map<string, number>(
    (db.prepare('SELECT id, abbr FROM nba_teams').all() as { id: number; abbr: string }[]).map((t) => [t.abbr, t.id])
  );
  const playerByName = new Map<string, number>(
    (db.prepare('SELECT id, name FROM nba_players').all() as { id: number; name: string }[]).map((p) => [
      normalizeName(p.name), p.id,
    ])
  );

  let inserted = 0;
  let matched = 0;
  let unmatched = 0;
  db.transaction(() => {
    const oldGames = db.prepare('SELECT id FROM nba_games WHERE gameday = ?').all(gameday) as { id: number }[];
    const delStats = db.prepare('DELETE FROM stat_lines WHERE game_id = ?');
    for (const g of oldGames) delStats.run(g.id);
    db.prepare('DELETE FROM nba_games WHERE gameday = ?').run(gameday);

    const insGame = db.prepare(
      `INSERT INTO nba_games (gameday, home_team_id, away_team_id, home_score, away_score, played, source)
       VALUES (?, ?, ?, ?, ?, 1, 'espn')`
    );
    const insStat = db.prepare(
      `INSERT INTO stat_lines (game_id, player_id, minutes, pts, reb, ast, stl, blk, tov, fp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const ev of events) {
      const homeId = teamIdByAbbr.get(ev.home);
      const awayId = teamIdByAbbr.get(ev.away);
      if (!homeId || !awayId) continue; // équipe inconnue (All-Star Game, etc.)
      const gameId = Number(insGame.run(gameday, homeId, awayId, ev.homeScore, ev.awayScore).lastInsertRowid);
      inserted++;

      for (const teamBox of ev.summary?.boxscore?.players ?? []) {
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
    }
  })();

  if (inserted === 0) return fail('aucun match exploitable (équipes inconnues)');
  return { ok: true, games: inserted, statLines: matched, unmatched };
}
