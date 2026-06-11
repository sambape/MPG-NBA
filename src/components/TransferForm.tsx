'use client';

import { useActionState, useMemo, useState } from 'react';
import type { FreePlayer } from './DraftBoard';

export interface OwnedPlayer {
  roster_id: number;
  player_id: number;
  name: string;
  pos: string;
  team_abbr: string;
  cote: number;
}

export default function TransferForm({
  roster, freePlayers, budget, action,
}: {
  roster: OwnedPlayer[];
  freePlayers: FreePlayer[];
  budget: number;
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
}) {
  const [outId, setOutId] = useState<number>(0);
  const [inId, setInId] = useState<number>(0);
  const [state, formAction, pending] = useActionState(action, null);

  const outPlayer = roster.find((r) => r.roster_id === outId);
  const candidates = useMemo(
    () => (outPlayer ? freePlayers.filter((p) => p.pos === outPlayer.pos) : []),
    [outPlayer, freePlayers]
  );
  const inPlayer = candidates.find((p) => p.id === inId);
  const cost = outPlayer && inPlayer ? inPlayer.cote - Math.floor(outPlayer.cote / 2) : null;

  return (
    <form action={formAction}>
      <label>Joueur qui quitte ton effectif (tu récupères la moitié de sa cote)</label>
      <select name="out" value={outId} onChange={(e) => { setOutId(Number(e.target.value)); setInId(0); }}>
        <option value={0}>— Choisir —</option>
        {roster.map((r) => (
          <option key={r.roster_id} value={r.roster_id}>
            [{r.pos}] {r.name} ({r.team_abbr}) — cote {r.cote} M
          </option>
        ))}
      </select>

      <label>Agent libre recruté (même poste, payé à sa cote)</label>
      <select name="in" value={inId} onChange={(e) => setInId(Number(e.target.value))} disabled={!outPlayer}>
        <option value={0}>— Choisir —</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.team_abbr}) — note {p.rating}, cote {p.cote} M
          </option>
        ))}
      </select>

      {cost !== null && (
        <p className={cost > budget ? 'error' : 'success'}>
          {cost >= 0
            ? `Coût du transfert : ${cost} M (budget : ${budget} M)`
            : `Tu récupères ${-cost} M sur ce transfert.`}
        </p>
      )}
      {state && state !== 'OK' && <p className="error">{state}</p>}
      {state === 'OK' && <p className="success">Transfert effectué ✓</p>}
      <p>
        <button className="btn" type="submit" disabled={pending || !outPlayer || !inPlayer || (cost !== null && cost > budget)}>
          {pending ? '…' : 'Valider le transfert'}
        </button>
      </p>
    </form>
  );
}
