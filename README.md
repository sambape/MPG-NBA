# 🏀 Mon Petit Parquet — Fantasy NBA entre amis

L'esprit de **Mon Petit Gazon**, transposé à la **NBA** : monte ta ligue avec tes amis, recrute
tes joueurs au mercato aux enchères, aligne ton cinq majeur chaque semaine et marque des points
fantasy sur les performances des vraies stars NBA — les 30 franchises et tous leurs matchs.

## Fonctionnalités

- **Comptes & ligues privées** — crée ta ligue (2 à 10 équipes) et invite tes amis avec un code à 6 caractères. Le créateur est le commissaire de la ligue.
- **Mercato aux enchères à l'aveugle (façon MPG)** — 500 M de budget par manager. À chaque tour, chacun place ses enchères en secret (mise minimum = la cote du joueur) ; le plus offrant remporte le joueur. Objectif : un effectif de 10 joueurs, 2 par poste (Meneur, Arrière, Ailier, Ailier fort, Pivot). Au bout de 15 tours, les effectifs incomplets sont complétés automatiquement et la saison démarre.
- **Compositions** — avant chaque journée, choisis ton cinq majeur (1 titulaire par poste). Si un titulaire ne joue aucun match de la semaine NBA, son remplaçant du banc au même poste entre automatiquement.
- **Duels chaque journée** — calendrier tête-à-tête (round-robin) entre les équipes de la ligue sur 26 journées. Le score d'une équipe = la somme des points fantasy de son cinq majeur sur la semaine NBA.
- **Points fantasy** — `points + 1,2×rebonds + 1,5×passes + 3×interceptions + 3×contres − balles perdues`.
- **Bonus « Boost MVP »** — 3 fois par saison, ton meilleur titulaire compte ×1,5 sur la journée.
- **Marché des transferts** — en cours de saison, échange un joueur de ton effectif contre un agent libre du même poste (tu récupères la moitié de la cote du sortant).
- **Tous les matchs NBA** — moteur de simulation intégré : 30 franchises, ~240 vrais joueurs notés, 26 journées, feuilles de stats complètes (points, rebonds, passes, interceptions, contres, balles perdues), scoreboard et tops de la journée.
- **Classement** — victoire = 2 pts, nul = 1 pt, départagé à la différence de points fantasy.

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvre [http://localhost:3000](http://localhost:3000).

La base SQLite (`mpg-nba.db`) est créée et remplie automatiquement au premier lancement
(franchises, joueurs, calendrier NBA complet).

## Déroulé d'une partie

1. Chaque joueur crée un compte, le commissaire crée la ligue et partage le code d'invitation.
2. Quand tout le monde est inscrit, le commissaire **lance le mercato**.
3. Chacun place ses enchères à l'aveugle, tour après tour, jusqu'à avoir 10 joueurs (2 par poste).
4. La saison démarre : chacun règle sa compo, puis le commissaire clique sur **« Jouer la journée »** — la semaine NBA est simulée (tous les matchs) et les duels de la ligue sont calculés.
5. Au bout des 26 journées, le premier du classement est sacré champion. 🏆

## Déploiement sur Netlify

Le dépôt est prêt pour Netlify (`netlify.toml` + plugin officiel Next.js) :

1. Sur [app.netlify.com](https://app.netlify.com), **Add new site → Import an existing project** et choisis ce dépôt GitHub.
2. Netlify détecte Next.js automatiquement (commande `npm run build`, plugin `@netlify/plugin-nextjs`). Rien à régler.
3. Recommandé : ajoute une variable d'environnement `SESSION_SECRET` (une longue chaîne aléatoire) dans **Site settings → Environment variables**.
4. Deploy. 🎉

> [!WARNING]
> **Persistance des données sur Netlify.** Netlify est *serverless* : le système de fichiers est
> en lecture seule (sauf `/tmp`) et éphémère. La base SQLite est donc placée dans `/tmp` et
> **réinitialisée à chaque démarrage à froid** — les comptes, ligues et résultats ne sont pas
> conservés durablement et ne sont pas partagés entre instances. C'est parfait pour une démo,
> mais **pas pour une vraie saison entre amis**.
>
> Pour une persistance réelle, branche une base SQLite hébergée **[Turso / libSQL](https://turso.tech/)**
> (compatible, généreux niveau gratuit) : il suffit de remplacer `better-sqlite3` par
> `@libsql/client` dans `src/lib/db.ts` (même dialecte SQL). Dis-le-moi et je fais la bascule.

## Stack technique

- [Next.js 15](https://nextjs.org/) (App Router, Server Actions, React 19)
- SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Simulation déterministe (graine par match/joueur) : les résultats sont stables et partagés entre toutes les ligues

## Données NBA réelles (API gratuite ESPN)

Les vraies données NBA sont la **source principale** du jeu, via l'API publique d'ESPN — la
seule option réellement gratuite avec feuilles de stats complètes, **sans clé ni inscription**.

Quand le commissaire clique sur **« Jouer la journée »**, l'app importe automatiquement les
matchs terminés de la vraie semaine NBA correspondante (journée 1 = semaine de
`NBA_SEASON_START`, 20 octobre 2025 par défaut) : scoreboard, box scores, rapprochement des
joueurs par nom, calcul des points fantasy. Si l'API est injoignable ou que la semaine n'a aucun
match (hors saison), la semaine est **simulée en secours** — le jeu reste jouable hors-ligne.

Pour forcer la simulation : `NBA_DATA_SOURCE=simulation`.

Import manuel d'une journée avec une date personnalisée :

```bash
# Importe la vraie semaine NBA du 5 au 11 janvier 2026 comme journée 1
npx tsx scripts/sync-espn.ts 1 2026-01-05
```

Alternatives évaluées : [balldontlie](https://www.balldontlie.io/) (gratuit limité aux
équipes/joueurs/matchs, les stats par joueur sont payantes), `stats.nba.com` (gratuit mais bloque
agressivement les requêtes hors navigateur), [Highlightly](https://highlightly.net/nba-api/)
(plan gratuit à 100 requêtes/jour, clé requise).

## Configuration

| Variable | Défaut | Description |
| --- | --- | --- |
| `DB_PATH` | `./mpg-nba.db` | Chemin du fichier SQLite |
| `SESSION_SECRET` | valeur de dev | Secret de signature des sessions (à définir en production) |
| `NBA_SEASON_START` | `2025-10-20` | Lundi de la semaine NBA correspondant à la journée 1 |
| `NBA_DATA_SOURCE` | (auto) | `simulation` pour désactiver l'import ESPN et tout simuler |
