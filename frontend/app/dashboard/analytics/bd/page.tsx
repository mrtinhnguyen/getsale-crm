'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, MessageSquare, Trophy, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { apiClient } from '@/lib/api/client';
import { reportError } from '@/lib/error-reporter';

function initials(name: string): string {
  const s = (name || '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 1).toUpperCase() || '?';
}

type PeriodKey = 'today' | 'week' | 'month';

interface NewChatsAccount {
  bd_account_id: string;
  account_display_name: string;
  new_chats: number;
  by_day: { date: string; new_chats: number }[];
}

interface ContactMetricsAccount {
  bd_account_id: string;
  account_display_name: string;
  total_contacts: number;
  not_read: number;
  read_no_reply: number;
  replied: number;
  pct_not_read: number;
  pct_read_no_reply: number;
  pct_replied: number;
}

type SortKey = 'account' | 'new_chats' | 'pct_not_read' | 'pct_read_no_reply' | 'pct_replied';

const PERIODS: PeriodKey[] = ['today', 'week', 'month'];

export default function AnalyticsBdPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [newChats, setNewChats] = useState<NewChatsAccount[]>([]);
  const [contactMetrics, setContactMetrics] = useState<ContactMetricsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('new_chats');
  const [sortDesc, setSortDesc] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [newChatsRes, metricsRes] = await Promise.all([
        apiClient.get<{ accounts: NewChatsAccount[] }>('/api/analytics/bd/new-chats', { params: { period } }),
        apiClient.get<{ accounts: ContactMetricsAccount[] }>('/api/analytics/bd/contact-metrics', { params: { period } }),
      ]);
      setNewChats(newChatsRes.data?.accounts ?? []);
      setContactMetrics(metricsRes.data?.accounts ?? []);
    } catch (error) {
      reportError(error, { component: 'AnalyticsBdPage', action: 'fetchData' });
      setNewChats([]);
      setContactMetrics([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const merged = contactMetrics.map((m) => {
    const nc = newChats.find((n) => n.bd_account_id === m.bd_account_id);
    return {
      ...m,
      new_chats: nc?.new_chats ?? 0,
    };
  });

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDesc((d) => !d);
    else {
      setSortBy(key);
      setSortDesc(key === 'account' ? false : true);
    }
  };

  const sorted = [...merged].sort((a, b) => {
    let v = 0;
    switch (sortBy) {
      case 'account':
        v = (a.account_display_name || '').localeCompare(b.account_display_name || '');
        break;
      case 'new_chats':
        v = a.new_chats - b.new_chats;
        break;
      case 'pct_not_read':
        v = a.pct_not_read - b.pct_not_read;
        break;
      case 'pct_read_no_reply':
        v = a.pct_read_no_reply - b.pct_read_no_reply;
        break;
      case 'pct_replied':
        v = a.pct_replied - b.pct_replied;
        break;
      default:
        v = 0;
    }
    return sortDesc ? -v : v;
  });

  const topByNewChats = sorted[0]?.bd_account_id;
  const topByReplied = [...merged].sort((a, b) => b.pct_replied - a.pct_replied)[0]?.bd_account_id;
  const topByNotRead = [...merged].sort((a, b) => b.pct_not_read - a.pct_not_read)[0]?.bd_account_id;
  const topByReadNoReply = [...merged].sort((a, b) => b.pct_read_no_reply - a.pct_read_no_reply)[0]?.bd_account_id;

  const totalNewChats = merged.reduce((s, a) => s + a.new_chats, 0);
  const withContacts = merged.filter((a) => a.total_contacts > 0);
  const avgPctReplied =
    withContacts.length > 0
      ? withContacts.reduce((s, a) => s + a.pct_replied, 0) / withContacts.length
      : 0;
  const activeAccountsCount = merged.filter((a) => a.new_chats > 0 || a.total_contacts > 0).length;

  const topNewChatsRow = [...merged].sort((a, b) => b.new_chats - a.new_chats)[0];
  const topRepliedRow = [...merged].sort((a, b) => b.pct_replied - a.pct_replied)[0];
  const topNotReadRow = [...merged].sort((a, b) => b.pct_not_read - a.pct_not_read)[0];
  const topReadNoReplyRow = [...merged].sort((a, b) => b.pct_read_no_reply - a.pct_read_no_reply)[0];

  if (loading && merged.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" aria-hidden />
      </div>
    );
  }

  const hasNoData = merged.length === 0 || merged.every((m) => m.new_chats === 0 && m.total_contacts === 0);

  if (hasNoData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground tracking-tight mb-1">
            {t('analyticsBd.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('analyticsBd.subtitle')}</p>
        </div>
        <div className="flex-1 flex items-center justify-center py-16">
          <EmptyState
            icon={BarChart3}
            title={t('analyticsBd.emptyTitle')}
            description={t('analyticsBd.emptyDesc')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground tracking-tight mb-1">
            {t('analyticsBd.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('analyticsBd.subtitle')}</p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted/30 p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                period === p ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`analyticsBd.period${p.charAt(0).toUpperCase() + p.slice(1)}` as const)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t('analyticsBd.totalNewChats')}</p>
              <p className="font-heading text-2xl font-bold text-foreground mt-1 tracking-tight">{totalNewChats}</p>
            </div>
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="w-5 h-5" />
            </div>
          </div>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t('analyticsBd.avgPctReplied')}</p>
              <p className="font-heading text-2xl font-bold text-foreground mt-1 tracking-tight">
                {withContacts.length > 0 ? `${avgPctReplied.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t('analyticsBd.activeAccounts')}</p>
              <p className="font-heading text-2xl font-bold text-foreground mt-1 tracking-tight">{activeAccountsCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </Card>
      </div>

      <Card title={t('analyticsBd.topForPeriod')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground font-medium">{t('analyticsBd.newChats')}</p>
            <p className="font-medium text-foreground mt-0.5">
              {topNewChatsRow && topNewChatsRow.new_chats > 0
                ? `${topNewChatsRow.account_display_name || topNewChatsRow.bd_account_id} — ${topNewChatsRow.new_chats}`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">{t('analyticsBd.pctReplied')}</p>
            <p className="font-medium text-foreground mt-0.5">
              {topRepliedRow && topRepliedRow.total_contacts > 0 && topRepliedRow.pct_replied > 0
                ? `${topRepliedRow.account_display_name || topRepliedRow.bd_account_id} — ${topRepliedRow.pct_replied.toFixed(1)}%`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">{t('analyticsBd.pctNotRead')}</p>
            <p className="font-medium text-foreground mt-0.5">
              {topNotReadRow && topNotReadRow.total_contacts > 0 && topNotReadRow.pct_not_read > 0
                ? `${topNotReadRow.account_display_name || topNotReadRow.bd_account_id} — ${topNotReadRow.pct_not_read.toFixed(1)}%`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">{t('analyticsBd.pctReadNoReply')}</p>
            <p className="font-medium text-foreground mt-0.5">
              {topReadNoReplyRow && topReadNoReplyRow.total_contacts > 0 && topReadNoReplyRow.pct_read_no_reply > 0
                ? `${topReadNoReplyRow.account_display_name || topReadNoReplyRow.bd_account_id} — ${topReadNoReplyRow.pct_read_no_reply.toFixed(1)}%`
                : '—'}
            </p>
          </div>
        </div>
      </Card>

      <Card title={t('analyticsBd.tableTitle')}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('account')}
                >
                  {t('analyticsBd.account')}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('new_chats')}
                >
                  {t('analyticsBd.newChats')}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('pct_not_read')}
                >
                  {t('analyticsBd.pctNotRead')}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('pct_read_no_reply')}
                >
                  {t('analyticsBd.pctReadNoReply')}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('pct_replied')}
                >
                  {t('analyticsBd.pctReplied')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row) => {
                const isTop =
                  (sortBy === 'new_chats' && row.bd_account_id === topByNewChats) ||
                  (sortBy === 'pct_replied' && row.bd_account_id === topByReplied) ||
                  (sortBy === 'pct_not_read' && row.bd_account_id === topByNotRead) ||
                  (sortBy === 'pct_read_no_reply' && row.bd_account_id === topByReadNoReply);
                const hasContacts = row.total_contacts > 0;
                return (
                  <tr
                    key={row.bd_account_id}
                    className={`hover:bg-muted/30 transition-colors ${
                      isTop ? 'bg-primary/10 ring-inset ring-1 ring-primary/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      <span className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold text-sm shrink-0"
                          aria-hidden
                        >
                          {initials(row.account_display_name || row.bd_account_id)}
                        </div>
                        <span className="flex items-center gap-2">
                          {row.account_display_name || row.bd_account_id}
                          {isTop ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <Trophy className="w-3.5 h-3.5" aria-hidden />
                              {t('analyticsBd.top')}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                      {row.new_chats}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                      {hasContacts ? `${row.pct_not_read.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                      {hasContacts ? `${row.pct_read_no_reply.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                      {hasContacts ? `${row.pct_replied.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
