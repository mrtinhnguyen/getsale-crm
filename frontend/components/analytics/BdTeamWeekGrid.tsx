'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BdTeamWeekCell, BdTeamWeekResponse } from '@/lib/api/analytics';
import { formatUtcDayShort } from '@/lib/analytics-week';
import { useLocaleStore } from '@/lib/stores/locale-store';

function initials(name: string): string {
  const s = (name || '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 1).toUpperCase() || '?';
}

const EMPTY_CELL: BdTeamWeekCell = {
  new_chats: 0,
  not_read: 0,
  read_no_reply: 0,
  replied: 0,
  pct_not_read: 0,
  pct_read_no_reply: 0,
  pct_replied: 0,
};

const CellCard = memo(function CellCard({ cell }: { cell: BdTeamWeekCell }) {
  const { t } = useTranslation();
  if (cell.new_chats === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 p-2 text-xs min-w-[108px] min-h-[88px] flex items-center justify-center text-muted-foreground">
        —
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-2 text-xs min-w-[108px] space-y-0.5">
      <div className="font-semibold text-foreground tabular-nums">{cell.new_chats}</div>
      <div className="text-muted-foreground tabular-nums leading-tight">
        <div>
          {t('analyticsBd.pctNotReadShort')}: {cell.pct_not_read.toFixed(1)}%
        </div>
        <div>
          {t('analyticsBd.pctReadNoReplyShort')}: {cell.pct_read_no_reply.toFixed(1)}%
        </div>
        <div>
          {t('analyticsBd.pctRepliedShort')}: {cell.pct_replied.toFixed(1)}%
        </div>
      </div>
    </div>
  );
});

export const BdTeamWeekGrid = memo(function BdTeamWeekGrid({ data }: { data: BdTeamWeekResponse }) {
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const localeStr = locale === 'ru' ? 'ru-RU' : 'en-US';

  const weekByBd = new Map(data.bd_week.map((r) => [r.bd_account_id, r.week]));

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th
              scope="col"
              className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-r border-border min-w-[160px]"
            >
              {t('analyticsBd.account')}
            </th>
            {data.days.map((d) => (
              <th
                key={d}
                scope="col"
                className="px-2 py-3 text-center text-xs font-medium text-muted-foreground whitespace-nowrap"
              >
                {formatUtcDayShort(d, localeStr)}
              </th>
            ))}
            <th
              scope="col"
              className="px-2 py-3 text-center text-xs font-medium text-primary whitespace-nowrap border-l border-border bg-muted/70"
            >
              {t('analyticsBd.columnWeek')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.matrix.map((row) => {
            const acc = data.accounts.find((a) => a.bd_account_id === row.bd_account_id);
            const name = acc?.account_display_name ?? row.bd_account_id;
            const weekCell = weekByBd.get(row.bd_account_id);
            return (
              <tr key={row.bd_account_id} className="hover:bg-muted/20">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2 text-left font-medium text-foreground border-r border-border align-top"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold text-xs shrink-0"
                      aria-hidden
                    >
                      {initials(name)}
                    </span>
                    <span className="truncate max-w-[120px]" title={name}>
                      {name}
                    </span>
                  </span>
                </th>
                {data.days.map((d) => (
                  <td key={d} className="px-2 py-2 align-top">
                    <CellCard cell={row.by_date[d]} />
                  </td>
                ))}
                <td className="px-2 py-2 align-top border-l border-border bg-muted/10">
                  <CellCard cell={weekCell ?? EMPTY_CELL} />
                </td>
              </tr>
            );
          })}
          <tr className="bg-muted/25 font-medium">
            <th
              scope="row"
              className="sticky left-0 z-10 bg-muted/90 px-3 py-2 text-left text-foreground border-r border-border align-top"
            >
              {t('analyticsBd.rowDayTotal')}
            </th>
            {data.days.map((d) => (
              <td key={d} className="px-2 py-2 align-top">
                <CellCard cell={data.day_totals[d]} />
              </td>
            ))}
            <td className="px-2 py-2 align-top border-l border-border bg-primary/5">
              <CellCard cell={data.week_grand} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});
