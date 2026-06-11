// Import manuel des vrais matchs NBA depuis l'API publique d'ESPN
// (gratuite, sans clé). Normalement inutile : « Jouer la journée » dans
// l'app importe automatiquement la semaine NBA correspondante. Ce script
// sert à importer une journée avec une date de début personnalisée.
//
// Usage : npx tsx scripts/sync-espn.ts <journée> [date-début YYYY-MM-DD]
//   ex. : npx tsx scripts/sync-espn.ts 1 2026-01-05
// Sans date, la semaine est déduite de NBA_SEASON_START (journée 1 = cette semaine-là).

import { importEspnWeek, gamedayStartDate } from '../src/lib/espn';

async function main() {
  const [gdArg, dateArg] = process.argv.slice(2);
  const gameday = Number(gdArg);
  if (!Number.isInteger(gameday) || gameday < 1 || (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg))) {
    console.error('Usage : npx tsx scripts/sync-espn.ts <journée> [date-début YYYY-MM-DD]');
    process.exit(1);
  }

  const start = dateArg ?? gamedayStartDate(gameday);
  console.log(`Import de la semaine NBA du ${start} comme journée ${gameday}…`);
  const res = await importEspnWeek(gameday, start);
  if (!res.ok) {
    console.error(`Échec : ${res.reason}`);
    process.exit(1);
  }
  console.log(
    `Journée ${gameday} importée : ${res.games} matchs réels, ${res.statLines} feuilles de stats rapprochées` +
    (res.unmatched ? ` (${res.unmatched} joueurs ESPN hors du pool du jeu, ignorés)` : '')
  );
  console.log('Dans l’app, « Jouer la journée » utilisera ces stats réelles.');
}

main().catch((err) => {
  console.error('Erreur :', err.message ?? err);
  process.exit(1);
});
