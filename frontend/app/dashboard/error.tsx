'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, LayoutDashboard } from 'lucide-react';
import { reportError } from '@/lib/error-reporter';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    reportError(error, { component: 'DashboardError' });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-soft p-8 max-w-md w-full">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>

        <h2 className="font-heading text-xl font-semibold text-foreground tracking-tight mb-2">
          {t('errors.dashboardTitle')}
        </h2>

        <p className="text-sm text-muted-foreground mb-6">
          {t('errors.dashboardDescription')}
        </p>

        {error.digest && (
          <p className="text-xs text-muted-foreground/70 mb-4 font-mono">
            {t('errors.errorCode', { digest: error.digest })}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" />
            {t('errors.tryAgain')}
          </button>

          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-all duration-150 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t('errors.goToDashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
}
