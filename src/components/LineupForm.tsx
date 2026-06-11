'use client';

import { useActionState, useState } from 'react';

export interface LineupPlayer {
  roster_id: number;
  name: string;
  pos: string;
  team_abbr: string;
  rating: number;
  is_starter: number;
  avg_fp: number;
}

export default function LineupForm({
  roster, posLabels, action, locked,
}: {
  roster: LineupPlayer[];
  posLabels: Record<string, string>;
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
  locked: boolean;
}) {
  const [starters, setStarters] = useState<Set<number>>(
    new Set(roster.filter((r) => r.is_starter).map((r) => r.roster_id))
  );
  const [state, formAction, pending] = useActionState(action, null);

  function toggle(p: LineupPlayer) {
    setStarters((prev) => {
      const next = new Set(prev);
      if (next.has(p.roster_id)) {
        next.delete(p.roster_id);
      } else {
        // Un seul titulaire par poste : on remplace l'éventuel titulaire du poste.
        for (const other of roster) {
          if (other.pos === p.pos && next.has(other.roster_id)) next.delete(other.roster_id);
        }
        next.add(p.roster_id);
      }
      return next;
    });
  }

  const valid = starters.size === 5;

  return (
    <form action={formAction}>
      {Object.entries(posLabels).map(([pos, label]) => (
        <div key={pos} style={{ marginBottom: 14 }}>
          <div className="muted" style={{ marginBottom: 6 }}>
            <span className="pos-tag">{pos}</span> {label}
          </div>
          {roster.filter((r) => r.pos === pos).map((p) => {
            const isStarter = starters.has(p.roster_id);
            return (
              <div key={p.roster_id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <strong>{p.name}</strong> <span className="muted">{p.team_abbr} · note {p.rating} · {p.avg_fp.toFixed(1)} pts fantasy / journée</span>
                </div>
                <button
                  type="button"
                  className={`btn small ${isStarter ? '' : 'secondary'}`}
                  onClick={() => toggle(p)}
                  disabled={locked}
                >
                  {isStarter ? 'Titulaire ★' : 'Banc'}
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {starters.size !== 5 && !locked && (
        <p className="muted">Sélectionne un titulaire par poste ({starters.size} / 5).</p>
      )}
      {state && state !== 'OK' && <p className="error">{state}</p>}
      {state === 'OK' && <p className="success">Compo enregistrée ✓</p>}
      {[...starters].map((id) => (
        <input key={id} type="hidden" name="starter" value={id} />
      ))}
      {!locked && (
        <button className="btn" type="submit" disabled={!valid || pending}>
          {pending ? '…' : 'Enregistrer ma compo'}
        </button>
      )}
    </form>
  );
}
