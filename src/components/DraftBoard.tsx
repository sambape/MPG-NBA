'use client';

import { useActionState, useMemo, useState } from 'react';

export interface FreePlayer {
  id: number;
  name: string;
  pos: string;
  team_abbr: string;
  rating: number;
  cote: number;
}

interface Props {
  players: FreePlayer[];
  needs: Record<string, number>;
  budget: number;
  posLabels: Record<string, string>;
  submitAction: (prev: string | null, formData: FormData) => Promise<string | null>;
}

export default function DraftBoard({ players, needs, budget, posLabels, submitAction }: Props) {
  const [bids, setBids] = useState<Map<number, number>>(new Map());
  const [filter, setFilter] = useState<string>('TOUS');
  const [search, setSearch] = useState('');
  const [state, formAction, pending] = useActionState(submitAction, null);

  const slotsRemaining = Object.values(needs).reduce((a, b) => a + b, 0);
  const totalBid = [...bids.values()].reduce((a, b) => a + b, 0);
  const reserve = Math.max(0, slotsRemaining - bids.size);
  const maxSpend = budget - reserve;

  const bidCountByPos = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of bids.keys()) {
      const p = players.find((pl) => pl.id === id);
      if (p) counts[p.pos] = (counts[p.pos] ?? 0) + 1;
    }
    return counts;
  }, [bids, players]);

  const visible = useMemo(
    () =>
      players.filter(
        (p) =>
          (filter === 'TOUS' || p.pos === filter) &&
          (search === '' || p.name.toLowerCase().includes(search.toLowerCase()) || p.team_abbr.toLowerCase().includes(search.toLowerCase()))
      ),
    [players, filter, search]
  );

  function setBid(player: FreePlayer, amount: number) {
    setBids((prev) => {
      const next = new Map(prev);
      if (amount <= 0) next.delete(player.id);
      else next.set(player.id, amount);
      return next;
    });
  }

  function canAdd(p: FreePlayer): boolean {
    if (bids.has(p.id)) return false;
    if (bids.size >= slotsRemaining) return false;
    if ((bidCountByPos[p.pos] ?? 0) >= (needs[p.pos] ?? 0)) return false;
    return true;
  }

  const bidList = [...bids.entries()].map(([id, amount]) => ({
    player: players.find((p) => p.id === id)!,
    amount,
  }));

  return (
    <div className="grid2">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Joueurs disponibles</h2>
        <div className="flex" style={{ marginBottom: 12 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }}>
            <option value="TOUS">Tous les postes</option>
            {Object.entries(posLabels).map(([pos, label]) => (
              <option key={pos} value={pos}>
                {label} ({needs[pos] ?? 0} manquant{(needs[pos] ?? 0) > 1 ? 's' : ''})
              </option>
            ))}
          </select>
          <input
            placeholder="Rechercher un joueur ou une équipe…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr><th>Joueur</th><th>Poste</th><th className="num">Note</th><th className="num">Cote</th><th></th></tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong> <span className="muted">{p.team_abbr}</span></td>
                  <td><span className="pos-tag">{p.pos}</span></td>
                  <td className="num">{p.rating}</td>
                  <td className="num">{p.cote} M</td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn small secondary"
                      disabled={!canAdd(p)}
                      onClick={() => setBid(p, p.cote)}
                    >
                      Enchérir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Mes enchères du tour</h2>
        <p className="muted">
          Budget : <strong>{budget} M</strong> · Misé : <strong>{totalBid} M</strong> · Réserve
          obligatoire : {reserve} M · Places restantes : {slotsRemaining}
        </p>
        {bidList.length === 0 && <p className="muted">Clique sur « Enchérir » pour ajouter un joueur. Mise minimum = sa cote.</p>}
        {bidList.map(({ player, amount }) => (
          <div key={player.id} className="flex-between" style={{ marginBottom: 8 }}>
            <div>
              <span className="pos-tag">{player.pos}</span> <strong>{player.name}</strong>{' '}
              <span className="muted">(cote {player.cote} M)</span>
            </div>
            <div className="flex">
              <input
                type="number"
                min={player.cote}
                max={maxSpend}
                value={amount}
                onChange={(e) => setBid(player, Number(e.target.value))}
                style={{ width: 90 }}
              />
              <button type="button" className="btn small secondary" onClick={() => setBid(player, 0)}>✕</button>
            </div>
          </div>
        ))}
        {totalBid > maxSpend && (
          <p className="error">Tu dépasses ton budget utilisable ({maxSpend} M, réserve comprise).</p>
        )}
        {state && <p className="error">{state}</p>}
        <form action={formAction}>
          <input
            type="hidden"
            name="bids"
            value={JSON.stringify(bidList.map((b) => ({ playerId: b.player.id, amount: b.amount })))}
          />
          <button className="btn" type="submit" disabled={pending || bidList.length === 0 || totalBid > maxSpend}>
            {pending ? '…' : `Valider mes ${bidList.length} enchère(s)`}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>
          Enchères à l’aveugle : personne ne voit tes mises. Le plus offrant remporte le joueur quand
          tous les managers ont validé.
        </p>
      </div>
    </div>
  );
}
