'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { currentUser, hashPassword, verifyPassword, setSession, clearSession } from '@/lib/auth';
import {
  createLeague, joinLeague, startDraft, submitBids, passRound, forceResolveRound,
  setLineup, activateBoost, playGameday, transferPlayer, getMember, type BidInput,
} from '@/lib/league';

// ---------- Auth ----------

export async function registerAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (username.length < 3) return 'Le pseudo doit faire au moins 3 caractères.';
  if (password.length < 4) return 'Le mot de passe doit faire au moins 4 caractères.';
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return 'Ce pseudo est déjà pris.';
  const res = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  await setSession(Number(res.lastInsertRowid));
  redirect('/');
}

export async function loginAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const row = getDb().prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as
    | { id: number; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return 'Pseudo ou mot de passe incorrect.';
  await setSession(row.id);
  redirect('/');
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
}

// ---------- Ligues ----------

export async function createLeagueAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const name = String(formData.get('name') ?? '').trim();
  const teamName = String(formData.get('teamName') ?? '').trim();
  const maxMembers = Number(formData.get('maxMembers') ?? 8);
  if (name.length < 2) return 'Donne un nom à ta ligue.';
  if (teamName.length < 2) return 'Donne un nom à ton équipe.';
  const leagueId = createLeague(name, user.id, teamName, maxMembers);
  redirect(`/league/${leagueId}`);
}

export async function joinLeagueAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const code = String(formData.get('code') ?? '').trim();
  const teamName = String(formData.get('teamName') ?? '').trim();
  if (teamName.length < 2) return 'Donne un nom à ton équipe.';
  const res = joinLeague(code, user.id, teamName);
  if (!res.ok) return res.error ?? 'Impossible de rejoindre la ligue.';
  redirect(`/league/${res.leagueId}`);
}

async function requireMember(leagueId: number) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const member = getMember(leagueId, user.id);
  if (!member) redirect('/');
  return { user, member };
}

export async function startDraftAction(leagueId: number) {
  const { user } = await requireMember(leagueId);
  startDraft(leagueId, user.id);
  revalidatePath(`/league/${leagueId}`);
  redirect(`/league/${leagueId}/draft`);
}

// ---------- Mercato ----------

export async function submitBidsAction(leagueId: number, _prev: string | null, formData: FormData): Promise<string | null> {
  const { member } = await requireMember(leagueId);
  const raw = String(formData.get('bids') ?? '[]');
  let bids: BidInput[];
  try {
    bids = JSON.parse(raw);
  } catch {
    return 'Enchères invalides.';
  }
  const res = submitBids(leagueId, member.id, bids);
  if (!res.ok) return res.error ?? 'Erreur lors de la soumission.';
  revalidatePath(`/league/${leagueId}/draft`);
  return null;
}

export async function passRoundAction(leagueId: number) {
  const { member } = await requireMember(leagueId);
  passRound(leagueId, member.id);
  revalidatePath(`/league/${leagueId}/draft`);
}

export async function forceResolveAction(leagueId: number) {
  const { user } = await requireMember(leagueId);
  forceResolveRound(leagueId, user.id);
  revalidatePath(`/league/${leagueId}/draft`);
}

// ---------- Saison ----------

export async function setLineupAction(leagueId: number, _prev: string | null, formData: FormData): Promise<string | null> {
  const { member } = await requireMember(leagueId);
  const ids = formData.getAll('starter').map((v) => Number(v));
  const res = setLineup(leagueId, member.id, ids);
  if (!res.ok) return res.error ?? 'Compo invalide.';
  revalidatePath(`/league/${leagueId}/team`);
  return 'OK';
}

export async function activateBoostAction(leagueId: number) {
  const { member } = await requireMember(leagueId);
  activateBoost(leagueId, member.id);
  revalidatePath(`/league/${leagueId}/team`);
}

export async function playGamedayAction(leagueId: number) {
  const { user } = await requireMember(leagueId);
  playGameday(leagueId, user.id);
  revalidatePath(`/league/${leagueId}`);
}

export async function transferAction(leagueId: number, _prev: string | null, formData: FormData): Promise<string | null> {
  const { member } = await requireMember(leagueId);
  const outRosterId = Number(formData.get('out'));
  const inPlayerId = Number(formData.get('in'));
  if (!outRosterId || !inPlayerId) return 'Sélectionne un joueur sortant et un joueur entrant.';
  const res = transferPlayer(leagueId, member.id, outRosterId, inPlayerId);
  if (!res.ok) return res.error ?? 'Transfert impossible.';
  revalidatePath(`/league/${leagueId}/market`);
  return 'OK';
}
