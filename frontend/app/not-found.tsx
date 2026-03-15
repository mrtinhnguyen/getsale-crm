'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-soft p-8 max-w-md w-full">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-6 w-6 text-muted-foreground" />
        </div>

        <h2 className="font-heading text-xl font-semibold text-foreground tracking-tight mb-2">
          {t('errors.notFoundTitle')}
        </h2>

        <p className="text-sm text-muted-foreground mb-6">
          {t('errors.notFoundDescription')}
        </p>

        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
        >
          <Home className="h-4 w-4" />
          {t('errors.goHome')}
        </Link>
      </div>
    </div>
  );
}
