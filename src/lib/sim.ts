// Moteur de simulation NBA : calendrier complet et feuilles de stats réalistes.
// Tout est déterministe à partir d'une graine (gameId, playerId) pour rester
// stable entre redémarrages du serveur.

export const GAMEDAYS = 26; // journées fantasy = semaines NBA
export const ROUNDS_PER_WEEK = 3; // chaque franchise joue 3 matchs par semaine

export type Pos = 'MJ' | 'AR' | 'AI' | 'AF' | 'PI';

// ---------- RNG déterministe ----------

function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bruit approximativement gaussien centré sur 1 (écart-type ~ spread/3).
function noise(rng: () => number, spread: number): number {
  return 1 + (rng() + rng() + rng() - 1.5) * (spread / 1.5);
}

// ---------- Calendrier ----------

// Méthode du cercle : round-robin entre N équipes, ROUNDS_PER_WEEK tours par
// journée, en cyclant sur le round-robin complet au fil de la saison.
export function generateNbaSchedule(teamAbbrs: string[]): [string, string][][] {
  const teams = [...teamAbbrs];
  const n = teams.length; // pair (30)
  const fixed = teams[0];
  let rotation = teams.slice(1);

  const allRounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    const lineup = [fixed, ...rotation];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      // Alternance domicile/extérieur selon le tour
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    allRounds.push(round);
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }

  const weeks: [string, string][][] = [];
  let cursor = 0;
  for (let w = 0; w < GAMEDAYS; w++) {
    const week: [string, string][] = [];
    for (let t = 0; t < ROUNDS_PER_WEEK; t++) {
      const round = allRounds[cursor % allRounds.length];
      // Au-delà du premier passage, on inverse domicile/extérieur.
      const flip = Math.floor(cursor / allRounds.length) % 2 === 1;
      for (const [h, a] of round) week.push(flip ? [a, h] : [h, a]);
      cursor++;
    }
    weeks.push(week);
  }
  return weeks;
}

// ---------- Simulation d'un joueur sur un match ----------

export interface SimStatLine {
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fp: number;
  dnp: boolean; // n'a pas joué (repos / pépin physique)
}

const REB_BASE: Record<Pos, number> = { MJ: 3.2, AR: 3.6, AI: 5.2, AF: 7.2, PI: 9.5 };
const AST_BASE: Record<Pos, number> = { MJ: 7.2, AR: 4.2, AI: 3.6, AF: 2.8, PI: 2.6 };
const BLK_BASE: Record<Pos, number> = { MJ: 0.3, AR: 0.4, AI: 0.6, AF: 0.9, PI: 1.7 };

export function fantasyPoints(s: { pts: number; reb: number; ast: number; stl: number; blk: number; tov: number }): number {
  return Math.round((s.pts + 1.2 * s.reb + 1.5 * s.ast + 3 * s.stl + 3 * s.blk - s.tov) * 10) / 10;
}

export function simulatePlayerGame(gameId: number, playerId: number, rating: number, pos: Pos): SimStatLine {
  const rng = mulberry32(hashSeed('game', gameId, 'player', playerId));

  // ~8 % de chance de ne pas jouer (load management, petits bobos)
  if (rng() < 0.08) {
    return { minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fp: 0, dnp: true };
  }

  const level = (rating - 60) / 39; // 0..1
  const minutes = Math.round(Math.min(40, Math.max(12, 16 + level * 22 + (rng() - 0.5) * 6)));
  const minFactor = minutes / 34;
  const ratingFactor = Math.max(0.15, (rating - 59) / 30);

  const pts = Math.max(0, Math.round(0.83 * (rating - 59) * minFactor * noise(rng, 0.55)));
  const reb = Math.max(0, Math.round(REB_BASE[pos] * (0.45 + level) * minFactor * noise(rng, 0.5)));
  const ast = Math.max(0, Math.round(AST_BASE[pos] * (0.4 + level) * minFactor * noise(rng, 0.5)));
  const stl = Math.max(0, Math.round((0.5 + level * 0.9) * minFactor * noise(rng, 0.9)));
  const blk = Math.max(0, Math.round(BLK_BASE[pos] * (0.4 + level) * minFactor * noise(rng, 0.9)));
  const tov = Math.max(0, Math.round((1 + level * 2.2 + ratingFactor) * minFactor * noise(rng, 0.6)));

  return { minutes, pts, reb, ast, stl, blk, tov, fp: fantasyPoints({ pts, reb, ast, stl, blk, tov }), dnp: false };
}

// Points "fond de banc" ajoutés au score d'équipe NBA pour que les totaux
// soient réalistes (l'effectif simulé ne compte que 8 joueurs).
export function benchFiller(gameId: number, teamId: number): number {
  const rng = mulberry32(hashSeed('bench', gameId, teamId));
  return 12 + Math.round(rng() * 14);
}
