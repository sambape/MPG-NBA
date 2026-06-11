import Database from 'better-sqlite3';
import path from 'path';
import { TEAMS, PLAYERS, ratingToCote } from './seed';
import { generateNbaSchedule, GAMEDAYS } from './sim';

// Sur Netlify (serverless), seul /tmp est accessible en écriture. Le fichier
// SQLite y est éphémère : il est recréé et re-seedé à chaque démarrage à froid,
// et n'est pas partagé entre instances. Voir le README pour passer à une base
// persistante (Turso/libSQL) en production.
const DEFAULT_DB_PATH = process.env.NETLIFY
  ? '/tmp/mpg-nba.db'
  : path.join(process.cwd(), 'mpg-nba.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

declare global {
  // eslint-disable-next-line no-var
  var __mpgDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (global.__mpgDb) return global.__mpgDb;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  global.__mpgDb = db;
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nba_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    abbr TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    conference TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nba_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    team_id INTEGER NOT NULL REFERENCES nba_teams(id),
    pos TEXT NOT NULL,
    rating INTEGER NOT NULL,
    cote INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nba_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gameday INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL REFERENCES nba_teams(id),
    away_team_id INTEGER NOT NULL REFERENCES nba_teams(id),
    home_score INTEGER,
    away_score INTEGER,
    played INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'simulation' -- simulation | espn
  );
  CREATE INDEX IF NOT EXISTS idx_nba_games_gameday ON nba_games(gameday);

  CREATE TABLE IF NOT EXISTS stat_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES nba_games(id),
    player_id INTEGER NOT NULL REFERENCES nba_players(id),
    minutes INTEGER NOT NULL,
    pts INTEGER NOT NULL,
    reb INTEGER NOT NULL,
    ast INTEGER NOT NULL,
    stl INTEGER NOT NULL,
    blk INTEGER NOT NULL,
    tov INTEGER NOT NULL,
    fp REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stat_lines_player ON stat_lines(player_id);
  CREATE INDEX IF NOT EXISTS idx_stat_lines_game ON stat_lines(game_id);

  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    commissioner_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'inscription', -- inscription | mercato | saison | terminee
    draft_round INTEGER NOT NULL DEFAULT 0,
    current_gameday INTEGER NOT NULL DEFAULT 0,
    max_members INTEGER NOT NULL DEFAULT 8,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS league_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    team_name TEXT NOT NULL,
    budget INTEGER NOT NULL DEFAULT 500,
    boosts_remaining INTEGER NOT NULL DEFAULT 3,
    boost_gameday INTEGER, -- journée où le boost MVP est activé
    draft_ready INTEGER NOT NULL DEFAULT 0,
    UNIQUE(league_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS rosters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id),
    member_id INTEGER NOT NULL REFERENCES league_members(id),
    player_id INTEGER NOT NULL REFERENCES nba_players(id),
    price INTEGER NOT NULL,
    is_starter INTEGER NOT NULL DEFAULT 0,
    UNIQUE(league_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_rosters_member ON rosters(member_id);

  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id),
    member_id INTEGER NOT NULL REFERENCES league_members(id),
    player_id INTEGER NOT NULL REFERENCES nba_players(id),
    amount INTEGER NOT NULL,
    round INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(league_id, member_id, player_id, round)
  );

  CREATE TABLE IF NOT EXISTS h2h_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id),
    gameday INTEGER NOT NULL,
    home_member_id INTEGER NOT NULL REFERENCES league_members(id),
    away_member_id INTEGER REFERENCES league_members(id), -- NULL = exempt
    home_score REAL,
    away_score REAL,
    played INTEGER NOT NULL DEFAULT 0,
    details TEXT -- JSON : feuilles de match des deux équipes
  );
  CREATE INDEX IF NOT EXISTS idx_h2h_league ON h2h_matches(league_id, gameday);

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id),
    member_id INTEGER NOT NULL REFERENCES league_members(id),
    out_player_id INTEGER NOT NULL REFERENCES nba_players(id),
    in_player_id INTEGER NOT NULL REFERENCES nba_players(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  // Bases créées avant l'ajout de la colonne source.
  const cols = db.prepare("PRAGMA table_info(nba_games)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'source')) {
    db.exec("ALTER TABLE nba_games ADD COLUMN source TEXT NOT NULL DEFAULT 'simulation'");
  }
}

function seed(db: Database.Database) {
  const teamCount = (db.prepare('SELECT COUNT(*) AS c FROM nba_teams').get() as { c: number }).c;
  if (teamCount > 0) return;

  const insertTeam = db.prepare(
    'INSERT INTO nba_teams (abbr, name, city, conference) VALUES (?, ?, ?, ?)'
  );
  const insertPlayer = db.prepare(
    'INSERT INTO nba_players (name, team_id, pos, rating, cote) VALUES (?, ?, ?, ?, ?)'
  );
  const insertGame = db.prepare(
    'INSERT INTO nba_games (gameday, home_team_id, away_team_id) VALUES (?, ?, ?)'
  );

  db.transaction(() => {
    const teamIds = new Map<string, number>();
    for (const t of TEAMS) {
      const res = insertTeam.run(t.abbr, t.name, t.city, t.conference);
      teamIds.set(t.abbr, Number(res.lastInsertRowid));
    }
    for (const p of PLAYERS) {
      insertPlayer.run(p.name, teamIds.get(p.team)!, p.pos, p.rating, ratingToCote(p.rating));
    }
    // Calendrier NBA complet : GAMEDAYS journées, chaque équipe joue chaque semaine.
    const abbrs = TEAMS.map((t) => t.abbr);
    const schedule = generateNbaSchedule(abbrs);
    for (let gd = 0; gd < schedule.length; gd++) {
      for (const [home, away] of schedule[gd]) {
        insertGame.run(gd + 1, teamIds.get(home)!, teamIds.get(away)!);
      }
    }
  })();
}

export { GAMEDAYS };
