import type Database from 'better-sqlite3';
import { getDb } from './db';
import { GAMEDAYS } from './sim';
import { simulatePlayerGame, benchFiller, type Pos } from './sim';
import { POSITIONS } from './seed';
import { importEspnWeek } from './espn';

export const BUDGET = 500;
export const ROSTER_SIZE = 10;
export const QUOTA_PER_POS = 2; // 2 joueurs par poste (MJ, AR, AI, AF, PI)
export const MAX_DRAFT_ROUNDS = 15;

// ---------- Types ----------

export interface League {
  id: number;
  name: string;
  code: string;
  commissioner_id: number;
  status: 'inscription' | 'mercato' | 'saison' | 'terminee';
  draft_round: number;
  current_gameday: number;
  max_members: number;
}

export interface Member {
  id: number;
  league_id: number;
  user_id: number;
  team_name: string;
  budget: number;
  boosts_remaining: number;
  boost_gameday: number | null;
  draft_ready: number;
  username?: string;
}

export interface RosterPlayer {
  roster_id: number;
  player_id: number;
  name: string;
  pos: Pos;
  rating: number;
  cote: number;
  price: number;
  is_starter: number;
  team_abbr: string;
}

// ---------- Lecture ----------

export function getLeague(id: number): League | null {
  return (getDb().prepare('SELECT * FROM leagues WHERE id = ?').get(id) as League) ?? null;
}

export function getMembers(leagueId: number): Member[] {
  return getDb()
    .prepare(
      `SELECT lm.*, u.username FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       WHERE lm.league_id = ? ORDER BY lm.id`
    )
    .all(leagueId) as Member[];
}

export function getMember(leagueId: number, userId: number): Member | null {
  return (
    (getDb()
      .prepare('SELECT * FROM league_members WHERE league_id = ? AND user_id = ?')
      .get(leagueId, userId) as Member) ?? null
  );
}

export function getRoster(leagueId: number, memberId: number): RosterPlayer[] {
  return getDb()
    .prepare(
      `SELECT r.id AS roster_id, p.id AS player_id, p.name, p.pos, p.rating, p.cote,
              r.price, r.is_starter, t.abbr AS team_abbr
       FROM rosters r
       JOIN nba_players p ON p.id = r.player_id
       JOIN nba_teams t ON t.id = p.team_id
       WHERE r.league_id = ? AND r.member_id = ?
       ORDER BY CASE p.pos WHEN 'MJ' THEN 0 WHEN 'AR' THEN 1 WHEN 'AI' THEN 2 WHEN 'AF' THEN 3 ELSE 4 END,
                r.is_starter DESC, p.rating DESC`
    )
    .all(leagueId, memberId) as RosterPlayer[];
}

export function getUserLeagues(userId: number): (League & { team_name: string })[] {
  return getDb()
    .prepare(
      `SELECT l.*, lm.team_name FROM leagues l
       JOIN league_members lm ON lm.league_id = l.id
       WHERE lm.user_id = ? ORDER BY l.created_at DESC`
    )
    .all(userId) as (League & { team_name: string })[];
}

// ---------- Création / inscription ----------

function randomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function createLeague(name: string, userId: number, teamName: string, maxMembers: number): number {
  const db = getDb();
  return db.transaction(() => {
    let code = randomCode();
    while (db.prepare('SELECT 1 FROM leagues WHERE code = ?').get(code)) code = randomCode();
    const res = db
      .prepare('INSERT INTO leagues (name, code, commissioner_id, max_members) VALUES (?, ?, ?, ?)')
      .run(name, code, userId, Math.min(10, Math.max(2, maxMembers)));
    const leagueId = Number(res.lastInsertRowid);
    db.prepare(
      'INSERT INTO league_members (league_id, user_id, team_name, budget) VALUES (?, ?, ?, ?)'
    ).run(leagueId, userId, teamName, BUDGET);
    return leagueId;
  })();
}

export function joinLeague(code: string, userId: number, teamName: string): { ok: boolean; leagueId?: number; error?: string } {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE code = ?').get(code.trim().toUpperCase()) as League | undefined;
  if (!league) return { ok: false, error: 'Code de ligue introuvable.' };
  if (league.status !== 'inscription') return { ok: false, error: 'Le mercato de cette ligue a déjà commencé.' };
  if (getMember(league.id, userId)) return { ok: false, error: 'Tu es déjà dans cette ligue.' };
  const count = getMembers(league.id).length;
  if (count >= league.max_members) return { ok: false, error: 'La ligue est complète.' };
  db.prepare('INSERT INTO league_members (league_id, user_id, team_name, budget) VALUES (?, ?, ?, ?)').run(
    league.id, userId, teamName, BUDGET
  );
  return { ok: true, leagueId: league.id };
}

// ---------- Mercato (enchères à l'aveugle, façon MPG) ----------

export function startDraft(leagueId: number, userId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league) return { ok: false, error: 'Ligue introuvable.' };
  if (league.commissioner_id !== userId) return { ok: false, error: 'Seul le commissaire peut lancer le mercato.' };
  if (league.status !== 'inscription') return { ok: false, error: 'Le mercato a déjà été lancé.' };
  if (getMembers(leagueId).length < 2) return { ok: false, error: 'Il faut au moins 2 équipes pour lancer le mercato.' };
  db.prepare("UPDATE leagues SET status = 'mercato', draft_round = 1 WHERE id = ?").run(leagueId);
  return { ok: true };
}

export function positionNeeds(leagueId: number, memberId: number): Record<Pos, number> {
  const roster = getRoster(leagueId, memberId);
  const needs = Object.fromEntries(POSITIONS.map((p) => [p, QUOTA_PER_POS])) as Record<Pos, number>;
  for (const r of roster) needs[r.pos] = Math.max(0, needs[r.pos] - 1);
  return needs;
}

export function slotsRemaining(leagueId: number, memberId: number): number {
  const needs = positionNeeds(leagueId, memberId);
  return Object.values(needs).reduce((a, b) => a + b, 0);
}

export interface BidInput {
  playerId: number;
  amount: number;
}

export function submitBids(leagueId: number, memberId: number, inputs: BidInput[]): { ok: boolean; error?: string } {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'mercato') return { ok: false, error: 'Le mercato n’est pas en cours.' };
  const member = db.prepare('SELECT * FROM league_members WHERE id = ?').get(memberId) as Member;
  const needs = positionNeeds(leagueId, memberId);
  const remaining = Object.values(needs).reduce((a, b) => a + b, 0);
  if (remaining === 0) return { ok: false, error: 'Ton effectif est déjà complet.' };
  if (inputs.length === 0) return { ok: false, error: 'Aucune enchère soumise.' };
  if (inputs.length > remaining) return { ok: false, error: `Tu ne peux enchérir que sur ${remaining} joueur(s) maximum.` };

  const ids = new Set(inputs.map((b) => b.playerId));
  if (ids.size !== inputs.length) return { ok: false, error: 'Enchères en double sur un même joueur.' };

  const bidsByPos: Record<string, number> = {};
  let total = 0;
  for (const bid of inputs) {
    const player = db
      .prepare('SELECT p.*, (SELECT 1 FROM rosters r WHERE r.league_id = ? AND r.player_id = p.id) AS taken FROM nba_players p WHERE p.id = ?')
      .get(leagueId, bid.playerId) as { id: number; name: string; pos: Pos; cote: number; taken: number | null } | undefined;
    if (!player) return { ok: false, error: 'Joueur introuvable.' };
    if (player.taken) return { ok: false, error: `${player.name} appartient déjà à une équipe de la ligue.` };
    if (!Number.isInteger(bid.amount) || bid.amount < player.cote)
      return { ok: false, error: `L’enchère sur ${player.name} doit être d’au moins ${player.cote} M (sa cote).` };
    bidsByPos[player.pos] = (bidsByPos[player.pos] ?? 0) + 1;
    if (bidsByPos[player.pos] > needs[player.pos])
      return { ok: false, error: `Trop d’enchères au poste ${player.pos} (il t’en manque ${needs[player.pos]}).` };
    total += bid.amount;
  }
  // Garde au moins 1 M par place restante non couverte par ces enchères.
  const reserve = remaining - inputs.length;
  if (total > member.budget - reserve)
    return { ok: false, error: `Budget insuffisant : ${total} M d’enchères pour ${member.budget} M disponibles (garde ${reserve} M de réserve).` };

  db.transaction(() => {
    db.prepare('DELETE FROM bids WHERE league_id = ? AND member_id = ? AND round = ?').run(
      leagueId, memberId, league.draft_round
    );
    const ins = db.prepare(
      'INSERT INTO bids (league_id, member_id, player_id, amount, round) VALUES (?, ?, ?, ?, ?)'
    );
    for (const bid of inputs) ins.run(leagueId, memberId, bid.playerId, bid.amount, league.draft_round);
    db.prepare('UPDATE league_members SET draft_ready = 1 WHERE id = ?').run(memberId);
  })();

  maybeResolveRound(leagueId);
  return { ok: true };
}

// Marque un membre comme "prêt sans enchère" (passe son tour).
export function passRound(leagueId: number, memberId: number) {
  const db = getDb();
  db.prepare('UPDATE league_members SET draft_ready = 1 WHERE id = ?').run(memberId);
  maybeResolveRound(leagueId);
}

function maybeResolveRound(leagueId: number) {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'mercato') return;
  const members = getMembers(leagueId);
  const pending = members.filter(
    (m) => slotsRemaining(leagueId, m.id) > 0 && !m.draft_ready
  );
  if (pending.length > 0) return;
  resolveRound(db, league, members);
}

// Force la résolution du tour (commissaire) même si tout le monde n'est pas prêt.
export function forceResolveRound(leagueId: number, userId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'mercato') return { ok: false, error: 'Le mercato n’est pas en cours.' };
  if (league.commissioner_id !== userId) return { ok: false, error: 'Seul le commissaire peut forcer la résolution.' };
  resolveRound(db, league, getMembers(leagueId));
  return { ok: true };
}

function resolveRound(db: Database.Database, league: League, members: Member[]) {
  db.transaction(() => {
    const bids = db
      .prepare(
        `SELECT b.*, p.pos, p.cote FROM bids b
         JOIN nba_players p ON p.id = b.player_id
         WHERE b.league_id = ? AND b.round = ?
         ORDER BY b.amount DESC, b.created_at ASC, b.id ASC`
      )
      .all(league.id, league.draft_round) as (BidInput & {
        member_id: number; player_id: number; amount: number; pos: Pos; cote: number;
      })[];

    const wonPlayers = new Set<number>();
    for (const bid of bids) {
      if (wonPlayers.has(bid.player_id)) continue; // une enchère plus haute a déjà gagné
      const member = db.prepare('SELECT * FROM league_members WHERE id = ?').get(bid.member_id) as Member;
      const needs = positionNeeds(league.id, member.id);
      const remaining = Object.values(needs).reduce((a, b) => a + b, 0);
      if (needs[bid.pos] <= 0) continue; // quota du poste atteint entre-temps
      if (member.budget - bid.amount < remaining - 1) continue; // garderait moins de 1 M par place restante
      const taken = db
        .prepare('SELECT 1 FROM rosters WHERE league_id = ? AND player_id = ?')
        .get(league.id, bid.player_id);
      if (taken) continue;
      db.prepare(
        'INSERT INTO rosters (league_id, member_id, player_id, price) VALUES (?, ?, ?, ?)'
      ).run(league.id, member.id, bid.player_id, bid.amount);
      db.prepare('UPDATE league_members SET budget = budget - ? WHERE id = ?').run(bid.amount, member.id);
      wonPlayers.add(bid.player_id);
    }

    db.prepare('UPDATE league_members SET draft_ready = 0 WHERE league_id = ?').run(league.id);

    const everyoneComplete = members.every((m) => slotsRemaining(league.id, m.id) === 0);
    if (everyoneComplete || league.draft_round >= MAX_DRAFT_ROUNDS) {
      if (!everyoneComplete) autoCompleteRosters(db, league.id);
      startSeason(db, league.id);
    } else {
      db.prepare('UPDATE leagues SET draft_round = draft_round + 1 WHERE id = ?').run(league.id);
    }
  })();
}

// Complète les effectifs incomplets avec les joueurs libres les moins chers.
function autoCompleteRosters(db: Database.Database, leagueId: number) {
  for (const member of getMembers(leagueId)) {
    const needs = positionNeeds(leagueId, member.id);
    for (const pos of POSITIONS) {
      for (let i = 0; i < needs[pos]; i++) {
        const player = db
          .prepare(
            `SELECT p.id, p.cote FROM nba_players p
             WHERE p.pos = ? AND p.id NOT IN (SELECT player_id FROM rosters WHERE league_id = ?)
             ORDER BY p.cote ASC, p.id ASC LIMIT 1`
          )
          .get(pos, leagueId) as { id: number; cote: number } | undefined;
        if (!player) continue;
        const price = Math.min(player.cote, Math.max(0, (db.prepare('SELECT budget FROM league_members WHERE id = ?').get(member.id) as { budget: number }).budget));
        db.prepare('INSERT INTO rosters (league_id, member_id, player_id, price) VALUES (?, ?, ?, ?)').run(
          leagueId, member.id, player.id, price
        );
        db.prepare('UPDATE league_members SET budget = MAX(0, budget - ?) WHERE id = ?').run(price, member.id);
      }
    }
  }
}

// ---------- Lancement de saison ----------

function startSeason(db: Database.Database, leagueId: number) {
  const members = getMembers(leagueId);

  // Compo par défaut : le meilleur joueur de chaque poste est titulaire.
  for (const member of members) {
    const roster = getRoster(leagueId, member.id);
    db.prepare('UPDATE rosters SET is_starter = 0 WHERE league_id = ? AND member_id = ?').run(leagueId, member.id);
    for (const pos of POSITIONS) {
      const best = roster.filter((r) => r.pos === pos).sort((a, b) => b.rating - a.rating)[0];
      if (best) db.prepare('UPDATE rosters SET is_starter = 1 WHERE id = ?').run(best.roster_id);
    }
  }

  // Calendrier H2H : round-robin répété sur toutes les journées NBA.
  const ids = members.map((m) => m.id);
  const slots: (number | null)[] = ids.length % 2 === 0 ? [...ids] : [...ids, null];
  const n = slots.length;
  const ins = db.prepare(
    'INSERT INTO h2h_matches (league_id, gameday, home_member_id, away_member_id) VALUES (?, ?, ?, ?)'
  );
  let rotation = slots.slice(1);
  const rounds: [number | null, number | null][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const lineup = [slots[0], ...rotation];
    const round: [number | null, number | null][] = [];
    for (let i = 0; i < n / 2; i++) round.push([lineup[i], lineup[n - 1 - i]]);
    rounds.push(round);
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }
  for (let gd = 1; gd <= GAMEDAYS; gd++) {
    const round = rounds[(gd - 1) % rounds.length];
    const flip = Math.floor((gd - 1) / rounds.length) % 2 === 1;
    for (const [a, b] of round) {
      const home = flip ? b : a;
      const away = flip ? a : b;
      if (home === null && away === null) continue;
      if (home === null) ins.run(leagueId, gd, away, null);
      else ins.run(leagueId, gd, home, away);
    }
  }

  db.prepare("UPDATE leagues SET status = 'saison', current_gameday = 1 WHERE id = ?").run(leagueId);
}

// ---------- Compo & bonus ----------

export function setLineup(leagueId: number, memberId: number, starterRosterIds: number[]): { ok: boolean; error?: string } {
  const db = getDb();
  const roster = getRoster(leagueId, memberId);
  const chosen = roster.filter((r) => starterRosterIds.includes(r.roster_id));
  if (chosen.length !== 5) return { ok: false, error: 'Il faut exactement 5 titulaires.' };
  const posSet = new Set(chosen.map((c) => c.pos));
  if (posSet.size !== 5) return { ok: false, error: 'Il faut un titulaire à chaque poste (MJ, AR, AI, AF, PI).' };
  db.transaction(() => {
    db.prepare('UPDATE rosters SET is_starter = 0 WHERE league_id = ? AND member_id = ?').run(leagueId, memberId);
    const upd = db.prepare('UPDATE rosters SET is_starter = 1 WHERE id = ?');
    for (const c of chosen) upd.run(c.roster_id);
  })();
  return { ok: true };
}

export function activateBoost(leagueId: number, memberId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'saison') return { ok: false, error: 'La saison n’est pas en cours.' };
  const member = db.prepare('SELECT * FROM league_members WHERE id = ?').get(memberId) as Member;
  if (member.boost_gameday === league.current_gameday) return { ok: false, error: 'Boost déjà activé pour cette journée.' };
  if (member.boosts_remaining <= 0) return { ok: false, error: 'Plus aucun boost MVP disponible cette saison.' };
  db.prepare('UPDATE league_members SET boosts_remaining = boosts_remaining - 1, boost_gameday = ? WHERE id = ?').run(
    league.current_gameday, memberId
  );
  return { ok: true };
}

// ---------- Journée : simulation NBA + résultats H2H ----------

function ensureNbaWeekPlayed(db: Database.Database, gameday: number) {
  const games = db
    .prepare('SELECT * FROM nba_games WHERE gameday = ? AND played = 0')
    .all(gameday) as { id: number; home_team_id: number; away_team_id: number }[];
  const playersByTeam = db.prepare('SELECT id, rating, pos FROM nba_players WHERE team_id = ?');
  const insStat = db.prepare(
    `INSERT INTO stat_lines (game_id, player_id, minutes, pts, reb, ast, stl, blk, tov, fp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const game of games) {
    let homePts = benchFiller(game.id, game.home_team_id);
    let awayPts = benchFiller(game.id, game.away_team_id);
    for (const side of ['home', 'away'] as const) {
      const teamId = side === 'home' ? game.home_team_id : game.away_team_id;
      const players = playersByTeam.all(teamId) as { id: number; rating: number; pos: Pos }[];
      for (const p of players) {
        const line = simulatePlayerGame(game.id, p.id, p.rating, p.pos);
        if (line.dnp) continue;
        insStat.run(game.id, p.id, line.minutes, line.pts, line.reb, line.ast, line.stl, line.blk, line.tov, line.fp);
        if (side === 'home') homePts += line.pts;
        else awayPts += line.pts;
      }
    }
    if (homePts === awayPts) homePts += 2; // prolongation, avantage du parquet
    db.prepare('UPDATE nba_games SET home_score = ?, away_score = ?, played = 1 WHERE id = ?').run(
      homePts, awayPts, game.id
    );
  }
}

export interface PlayerGamedayScore {
  player_id: number;
  name: string;
  pos: Pos;
  team_abbr: string;
  games_played: number;
  fp: number;
  starter: boolean;
  subbed_in?: boolean;
  boosted?: boolean;
}

function playerWeekFp(db: Database.Database, playerId: number, gameday: number): { fp: number; games: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.fp), 0) AS fp, COUNT(sl.id) AS games
       FROM stat_lines sl JOIN nba_games g ON g.id = sl.game_id
       WHERE sl.player_id = ? AND g.gameday = ?`
    )
    .get(playerId, gameday) as { fp: number; games: number };
  return { fp: Math.round(row.fp * 10) / 10, games: row.games };
}

function computeMemberGameday(db: Database.Database, leagueId: number, member: Member, gameday: number): { total: number; lines: PlayerGamedayScore[] } {
  const roster = getRoster(leagueId, member.id);
  const starters = roster.filter((r) => r.is_starter);
  const bench = roster.filter((r) => !r.is_starter);
  const usedBench = new Set<number>();
  const lines: PlayerGamedayScore[] = [];

  for (const starter of starters) {
    const week = playerWeekFp(db, starter.player_id, gameday);
    if (week.games > 0) {
      lines.push({
        player_id: starter.player_id, name: starter.name, pos: starter.pos, team_abbr: starter.team_abbr,
        games_played: week.games, fp: week.fp, starter: true,
      });
    } else {
      // Remplacement automatique : le remplaçant du même poste entre en jeu.
      const sub = bench.find((b) => b.pos === starter.pos && !usedBench.has(b.roster_id));
      if (sub) {
        usedBench.add(sub.roster_id);
        const subWeek = playerWeekFp(db, sub.player_id, gameday);
        lines.push({
          player_id: sub.player_id, name: sub.name, pos: sub.pos, team_abbr: sub.team_abbr,
          games_played: subWeek.games, fp: subWeek.fp, starter: true, subbed_in: true,
        });
      } else {
        lines.push({
          player_id: starter.player_id, name: starter.name, pos: starter.pos, team_abbr: starter.team_abbr,
          games_played: 0, fp: 0, starter: true,
        });
      }
    }
  }

  // Bonus "Boost MVP" : le meilleur titulaire compte 1,5×.
  if (member.boost_gameday === gameday && lines.length > 0) {
    const best = lines.reduce((a, b) => (b.fp > a.fp ? b : a));
    best.fp = Math.round(best.fp * 1.5 * 10) / 10;
    best.boosted = true;
  }

  const total = Math.round(lines.reduce((s, l) => s + l.fp, 0) * 10) / 10;
  return { total, lines };
}

export async function playGameday(leagueId: number, userId: number): Promise<{ ok: boolean; error?: string; source?: string }> {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'saison') return { ok: false, error: 'La saison n’est pas en cours.' };
  if (league.commissioner_id !== userId) return { ok: false, error: 'Seul le commissaire peut lancer la journée.' };

  const gameday = league.current_gameday;

  // Source principale : les vrais matchs de la semaine NBA via ESPN.
  // En cas d'échec (réseau, hors saison), la semaine est simulée.
  let source = 'simulation';
  const alreadyImported = db
    .prepare("SELECT COUNT(*) AS c FROM nba_games WHERE gameday = ? AND played = 1")
    .get(gameday) as { c: number };
  if (alreadyImported.c === 0) {
    const res = await importEspnWeek(gameday);
    if (res.ok) source = 'espn';
    else console.warn(`Journée ${gameday} : repli sur la simulation — ${res.reason}`);
  } else {
    const existing = db
      .prepare("SELECT source FROM nba_games WHERE gameday = ? AND played = 1 LIMIT 1")
      .get(gameday) as { source: string };
    source = existing.source;
  }

  db.transaction(() => {
    ensureNbaWeekPlayed(db, gameday);

    const members = new Map(getMembers(leagueId).map((m) => [m.id, m]));
    const matches = db
      .prepare('SELECT * FROM h2h_matches WHERE league_id = ? AND gameday = ? AND played = 0')
      .all(leagueId, gameday) as { id: number; home_member_id: number; away_member_id: number | null }[];

    for (const match of matches) {
      const home = computeMemberGameday(db, leagueId, members.get(match.home_member_id)!, gameday);
      const away = match.away_member_id
        ? computeMemberGameday(db, leagueId, members.get(match.away_member_id)!, gameday)
        : { total: 0, lines: [] };
      db.prepare(
        'UPDATE h2h_matches SET home_score = ?, away_score = ?, played = 1, details = ? WHERE id = ?'
      ).run(home.total, away.total, JSON.stringify({ home: home.lines, away: away.lines }), match.id);
    }

    if (gameday >= GAMEDAYS) {
      db.prepare("UPDATE leagues SET status = 'terminee' WHERE id = ?").run(leagueId);
    } else {
      db.prepare('UPDATE leagues SET current_gameday = current_gameday + 1 WHERE id = ?').run(leagueId);
    }
  })();
  return { ok: true, source };
}

// ---------- Classement ----------

export interface StandingRow {
  member: Member;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number; // V=2, N=1, D=0
}

export function getStandings(leagueId: number): StandingRow[] {
  const db = getDb();
  const members = getMembers(leagueId);
  const rows = new Map<number, StandingRow>(
    members.map((m) => [m.id, { member: m, wins: 0, losses: 0, draws: 0, pointsFor: 0, pointsAgainst: 0, points: 0 }])
  );
  const matches = db
    .prepare('SELECT * FROM h2h_matches WHERE league_id = ? AND played = 1')
    .all(leagueId) as { home_member_id: number; away_member_id: number | null; home_score: number; away_score: number }[];
  for (const m of matches) {
    if (m.away_member_id === null) continue; // exempt
    const home = rows.get(m.home_member_id)!;
    const away = rows.get(m.away_member_id)!;
    home.pointsFor += m.home_score; home.pointsAgainst += m.away_score;
    away.pointsFor += m.away_score; away.pointsAgainst += m.home_score;
    if (m.home_score > m.away_score) { home.wins++; away.losses++; }
    else if (m.home_score < m.away_score) { away.wins++; home.losses++; }
    else { home.draws++; away.draws++; }
  }
  for (const r of rows.values()) r.points = r.wins * 2 + r.draws;
  return [...rows.values()].sort(
    (a, b) => b.points - a.points || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || b.pointsFor - a.pointsFor
  );
}

// ---------- Marché des transferts (en saison) ----------

export function transferPlayer(leagueId: number, memberId: number, outRosterId: number, inPlayerId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const league = getLeague(leagueId);
  if (!league || league.status !== 'saison') return { ok: false, error: 'Le marché n’est ouvert que pendant la saison.' };

  const out = db
    .prepare(
      `SELECT r.*, p.pos, p.cote, p.name FROM rosters r JOIN nba_players p ON p.id = r.player_id
       WHERE r.id = ? AND r.league_id = ? AND r.member_id = ?`
    )
    .get(outRosterId, leagueId, memberId) as { id: number; player_id: number; pos: Pos; cote: number; name: string; is_starter: number } | undefined;
  if (!out) return { ok: false, error: 'Joueur sortant introuvable dans ton effectif.' };

  const incoming = db
    .prepare(
      `SELECT p.*, (SELECT 1 FROM rosters r WHERE r.league_id = ? AND r.player_id = p.id) AS taken
       FROM nba_players p WHERE p.id = ?`
    )
    .get(leagueId, inPlayerId) as { id: number; name: string; pos: Pos; cote: number; taken: number | null } | undefined;
  if (!incoming) return { ok: false, error: 'Joueur entrant introuvable.' };
  if (incoming.taken) return { ok: false, error: `${incoming.name} appartient déjà à une équipe de la ligue.` };
  if (incoming.pos !== out.pos) return { ok: false, error: 'Le joueur entrant doit jouer au même poste que le sortant.' };

  const member = db.prepare('SELECT * FROM league_members WHERE id = ?').get(memberId) as Member;
  const cost = incoming.cote - Math.floor(out.cote / 2); // on récupère la moitié de la cote du sortant
  if (member.budget < cost) return { ok: false, error: `Budget insuffisant : il faut ${cost} M (tu as ${member.budget} M).` };

  db.transaction(() => {
    db.prepare('DELETE FROM rosters WHERE id = ?').run(out.id);
    db.prepare('INSERT INTO rosters (league_id, member_id, player_id, price, is_starter) VALUES (?, ?, ?, ?, ?)').run(
      leagueId, memberId, incoming.id, incoming.cote, out.is_starter
    );
    db.prepare('UPDATE league_members SET budget = budget - ? WHERE id = ?').run(cost, memberId);
    db.prepare('INSERT INTO transfers (league_id, member_id, out_player_id, in_player_id) VALUES (?, ?, ?, ?)').run(
      leagueId, memberId, out.player_id, incoming.id
    );
  })();
  return { ok: true };
}
