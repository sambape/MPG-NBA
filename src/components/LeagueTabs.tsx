'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function LeagueTabs({ leagueId, status }: { leagueId: number; status: string }) {
  const pathname = usePathname();
  const base = `/league/${leagueId}`;
  const tabs: { href: string; label: string; show: boolean }[] = [
    { href: base, label: 'Ligue', show: true },
    { href: `${base}/draft`, label: 'Mercato', show: status === 'mercato' || status === 'inscription' },
    { href: `${base}/team`, label: 'Mon équipe', show: status === 'saison' || status === 'terminee' },
    { href: `${base}/schedule`, label: 'Calendrier', show: status === 'saison' || status === 'terminee' },
    { href: `${base}/market`, label: 'Marché', show: status === 'saison' },
  ];
  return (
    <div className="tabs">
      {tabs.filter((t) => t.show).map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? 'active' : ''}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
