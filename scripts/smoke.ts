// Test de bout en bout de la logique de jeu (sans HTTP) :
//   inscription → mercato → saison complète → champion.
// Lancement : DB_PATH=/tmp/smoke.db npx tsx scripts/smoke.ts

import { getDb } from '../src/lib/db';
import {
  createLeague, joinLeague, startDraft, submitBids, getLeague, getMembers,
  getRoster, slotsRemaining, positionNeeds, playGameday, getStandings,
  setLineup, activateBoost, transferPlayer,
} from '../src/lib/league';
import { GAMEDAYS } from '../src/lib/sim';
import { POSITIONS } from '../src/lib/seed';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ÉCHEC : ${msg}`);
}

async function main() {

const db = getDb();

// Joueurs du jeu
const counts = db.prepare('SELECT COUNT(*) c FROM nba_players').get() as { c: number };
assert(counts.c >= 200, `pool de joueurs trop petit (${counts.c})`);
const gamesCount = db.prepare('SELECT COUNT(*) c FROM nba_games').get() as { c: number };
assert(gamesCount.c === GAMEDAYS * 45, `calendrier NBA incomplet (${gamesCount.c} matchs)`);
console.log(`✓ Seed : ${counts.c} joueurs, ${gamesCount.c} matchs NBA sur ${GAMEDAYS} journées`);

// 3 utilisateurs
const userIds: number[] = [];
for (const name of ['samy', 'karim', 'leila']) {
  const res = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`${name}_${Date.now()}`, 'x:y');
  userIds.push(Number(res.lastInsertRowid));
}

const leagueId = createLeague('Ligue Test', userIds[0], 'Équipe Samy', 8);
assert(joinLeague(getLeague(leagueId)!.code, userIds[1], 'Équipe Karim').ok, 'join karim');
assert(joinLeague(getLeague(leagueId)!.code, userIds[2], 'Équipe Leila').ok, 'join leila');
assert(startDraft(leagueId, userIds[0]).ok, 'lancement mercato');
assert(getLeague(leagueId)!.status === 'mercato', 'statut mercato');
console.log('✓ Ligue créée, 3 équipes, mercato lancé');

// Mercato : chaque membre enchérit sur les meilleurs joueurs dispo à chaque tour
let rounds = 0;
while (getLeague(leagueId)!.status === 'mercato' && rounds < 20) {
  rounds++;
  for (const member of getMembers(leagueId)) {
    if (slotsRemaining(leagueId, member.id) === 0) continue;
    const needs = positionNeeds(leagueId, member.id);
    const bids: { playerId: number; amount: number }[] = [];
    for (const pos of POSITIONS) {
      if (needs[pos] <= 0) continue;
      const free = db.prepare(
        `SELECT p.id, p.cote FROM nba_players p
         WHERE p.pos = ? AND p.id NOT IN (SELECT player_id FROM rosters WHERE league_id = ?)
         ORDER BY p.rating DESC LIMIT ?`
      ).all(pos, leagueId, needs[pos]) as { id: number; cote: number }[];
      for (const f of free) bids.push({ playerId: f.id, amount: f.cote + (member.id % 3) });
    }
    const fresh = db.prepare('SELECT budget FROM league_members WHERE id = ?').get(member.id) as { budget: number };
    const remaining = slotsRemaining(leagueId, member.id);
    let total = bids.reduce((s, b) => s + b.amount, 0);
    while (total > fresh.budget - (remaining - bids.length) && bids.length > 0) {
      total -= bids.pop()!.amount;
    }
    if (bids.length === 0) continue;
    const res = submitBids(leagueId, member.id, bids);
    assert(res.ok, `enchères tour ${rounds} (${member.team_name}) : ${res.error}`);
  }
}
assert(getLeague(leagueId)!.status === 'saison', `le mercato devrait être terminé (statut: ${getLeague(leagueId)!.status})`);
for (const m of getMembers(leagueId)) {
  const roster = getRoster(leagueId, m.id);
  assert(roster.length === 10, `${m.team_name} : effectif de ${roster.length}`);
  assert(roster.filter((r) => r.is_starter).length === 5, `${m.team_name} : 5 titulaires par défaut`);
  assert(m.budget >= 0, `${m.team_name} : budget négatif`);
}
console.log(`✓ Mercato résolu en ${rounds} tour(s), effectifs complets (10 joueurs, 5 titulaires)`);

// Changement de compo + boost
const samy = getMembers(leagueId)[0];
const roster = getRoster(leagueId, samy.id);
const newStarters = POSITIONS.map(
  (pos) => roster.filter((r) => r.pos === pos).sort((a, b) => a.rating - b.rating)[0].roster_id
);
assert(setLineup(leagueId, samy.id, newStarters).ok, 'setLineup');
assert(activateBoost(leagueId, samy.id).ok, 'activateBoost');
console.log('✓ Compo modifiée et boost MVP activé');

// Saison complète (en simulation pure, sans appel réseau)
process.env.NBA_DATA_SOURCE = 'simulation';
for (let gd = 1; gd <= GAMEDAYS; gd++) {
  const res = await playGameday(leagueId, userIds[0]);
  assert(res.ok, `journée ${gd} : ${res.error}`);
  assert(res.source === 'simulation', `journée ${gd} : source attendue simulation, reçu ${res.source}`);
}
const league = getLeague(leagueId)!;
assert(league.status === 'terminee', 'saison terminée');
const played = db.prepare('SELECT COUNT(*) c FROM nba_games WHERE played = 1').get() as { c: number };
assert(played.c === GAMEDAYS * 45, 'tous les matchs NBA joués');
const stats = db.prepare('SELECT COUNT(*) c, AVG(fp) avg FROM stat_lines').get() as { c: number; avg: number };
console.log(`✓ Saison jouée : ${played.c} matchs NBA, ${stats.c} feuilles de stats (fantasy moyen ${stats.avg.toFixed(1)})`);

const avgScore = db.prepare('SELECT AVG(home_score) a FROM nba_games').get() as { a: number };
assert(avgScore.a > 85 && avgScore.a < 140, `scores NBA réalistes (moyenne ${avgScore.a.toFixed(1)})`);
console.log(`✓ Score NBA moyen à domicile : ${avgScore.a.toFixed(1)} points`);

const standings = getStandings(leagueId);
assert(standings.length === 3, 'classement à 3 équipes');
const totalGames = standings.reduce((s, r) => s + r.wins + r.losses + r.draws, 0);
assert(totalGames > 0, 'des duels ont été joués');
console.log('✓ Classement final :');
for (const [i, row] of standings.entries()) {
  console.log(`   ${i + 1}. ${row.member.team_name} — ${row.wins}V ${row.draws}N ${row.losses}D, ${row.pointsFor.toFixed(1)} pts fantasy`);
}

// Marché : transfert sur une ligue encore en saison
const league2 = createLeague('Ligue Marché', userIds[0], 'A', 8);
joinLeague(getLeague(league2)!.code, userIds[1], 'B');
startDraft(league2, userIds[0]);
for (let r = 0; r < 20 && getLeague(league2)!.status === 'mercato'; r++) {
  for (const m of getMembers(league2)) {
    if (slotsRemaining(league2, m.id) === 0) continue;
    const needs = positionNeeds(league2, m.id);
    const bids: { playerId: number; amount: number }[] = [];
    for (const pos of POSITIONS) {
      if (needs[pos] <= 0) continue;
      const free = db.prepare(
        `SELECT p.id, p.cote FROM nba_players p WHERE p.pos = ? AND p.id NOT IN
         (SELECT player_id FROM rosters WHERE league_id = ?) ORDER BY p.cote ASC LIMIT ?`
      ).all(pos, league2, needs[pos]) as { id: number; cote: number }[];
      for (const f of free) bids.push({ playerId: f.id, amount: f.cote });
    }
    if (bids.length) submitBids(league2, m.id, bids);
  }
}
assert(getLeague(league2)!.status === 'saison', 'ligue 2 en saison');
const memberA = getMembers(league2)[0];
const rosterA = getRoster(league2, memberA.id);
const out = rosterA[0];
const freeIn = db.prepare(
  `SELECT p.id FROM nba_players p WHERE p.pos = ? AND p.id NOT IN
   (SELECT player_id FROM rosters WHERE league_id = ?) ORDER BY p.cote ASC LIMIT 1`
).get(out.pos, league2) as { id: number };
const tr = transferPlayer(league2, memberA.id, out.roster_id, freeIn.id);
assert(tr.ok, `transfert : ${tr.error}`);
assert(getRoster(league2, memberA.id).length === 10, 'effectif toujours à 10 après transfert');
console.log('✓ Marché des transferts : échange validé, effectif intact');

console.log('\n🏆 Tous les tests passent !');
}

main().catch((err) => { console.error(err); process.exit(1); });
