'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { BdTeamWeekGrid } from '@/components/analytics/BdTeamWeekGrid';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { fetchBdTeamWeek, type BdTeamWeekResponse } from '@/lib/api/analytics';
import { addUtcDays, startOfUtcWeekMonday } from '@/lib/analytics-week';
import { reportError } from '@/lib/error-reporter';

const HISTORY_DAYS = 30;

export default function BdTeamWeekPage() {
  const { t } = useTranslation();
  const [weekStart, setWeekStart] = useState(() => startOfUtcWeekMonday(new Date()));
  const [data, setData] = useState<BdTeamWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const minWeekMonday = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - HISTORY_DAYS);
    return startOfUtcWeekMonday(d);
  }, []);

  const currentMonday = startOfUtcWeekMonday(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBdTeamWeek(weekStart);
      setData(res);
    } catch (e) {
      reportError(e, { component: 'BdTeamWeekPage', action: 'fetchBdTeamWeek' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const canGoPrev = weekStart > minWeekMonday;
  const canGoNext = weekStart < currentMonday;

  const rangeLabel = useMemo(() => {
    if (!data?.days.length) return '';
    const a = data.days[0];
    const b = data.days[6];
    return `${a} — ${b}`;
  }, [data?.days]);

  const showInitialSpinner = loading && !data;

  if (showInitialSpinner) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground tracking-tight mb-1">{t('analyticsBd.teamWeekTitle')}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">{t('analyticsBd.teamWeekSubtitle')}</p>
          <p className="text-xs text-muted-foreground mt-2">{t('analyticsBd.teamWeekAvgHint')}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <span className="inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground w-fit">
            {t('analyticsBd.dmOnlyBadge')}
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
              disabled={!canGoPrev}
              onClick={() => setWeekStart((w) => addUtcDays(w, -7))}
              aria-label={t('analyticsBd.prevWeek')}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-2 text-sm font-medium text-foreground tabular-nums min-w-[10rem] text-center">{rangeLabel}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
              disabled={!canGoNext}
              onClick={() => setWeekStart((w) => addUtcDays(w, 7))}
              aria-label={t('analyticsBd.nextWeek')}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="ml-1"
              onClick={() => setWeekStart(startOfUtcWeekMonday(new Date()))}
            >
              {t('analyticsBd.thisWeek')}
            </Button>
          </div>
        </div>
      </div>

      {!data ? (
        <EmptyState
          icon={CalendarRange}
          title={t('analyticsBd.teamWeekLoadError')}
          description={t('analyticsBd.teamWeekRetry')}
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              {t('analyticsBd.retry')}
            </Button>
          }
        />
      ) : data.accounts.length === 0 ? (
        <EmptyState icon={CalendarRange} title={t('analyticsBd.teamWeekNoAccounts')} description={t('analyticsBd.teamWeekNoAccountsHint')} />
      ) : (
        <>
          <div className="relative">
            {loading ? (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-[1px]"
                aria-busy
              >
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" aria-hidden />
              </div>
            ) : null}
            <BdTeamWeekGrid data={data} />
          </div>
          {data.data_available_from ? (
            <p className="text-xs text-muted-foreground">
              {t('analyticsBd.dataFrom', { date: data.data_available_from })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
