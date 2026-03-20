'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

const TABS: { href: string; match: (path: string) => boolean; labelKey: string }[] = [
  {
    href: '/dashboard/analytics/bd',
    match: (p) => p === '/dashboard/analytics/bd',
    labelKey: 'analyticsBd.tabOverview',
  },
  {
    href: '/dashboard/analytics/bd/team-week',
    match: (p) => p.startsWith('/dashboard/analytics/bd/team-week'),
    labelKey: 'analyticsBd.tabTeamWeek',
  },
];

export function BdAnalyticsTabs() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <nav className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30 w-fit" aria-label={t('analyticsBd.tabsAria')}>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={clsx(
              'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
