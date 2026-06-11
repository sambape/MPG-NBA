import { redirect, notFound } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getLeague, getMember } from '@/lib/league';
import LeagueTabs from '@/components/LeagueTabs';
import { GAMEDAYS } from '@/lib/sim';

export default async function LeagueLayout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const leagueId = Number(id);
  const user = await currentUser();
  if (!user) redirect('/login');
  const league = getLeague(leagueId);
  if (!league) notFound();
  const member = getMember(leagueId, user.id);
  if (!member) redirect('/');

  return (
    <>
      <div className="flex-between" style={{ marginTop: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>{league.name}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Code d’invitation : <span className="code-pill">{league.code}</span>
            {league.status === 'saison' && <> · Journée {league.current_gameday} / {GAMEDAYS}</>}
          </p>
        </div>
      </div>
      <LeagueTabs leagueId={leagueId} status={league.status} />
      {children}
    </>
  );
}
