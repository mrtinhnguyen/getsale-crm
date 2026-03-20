import { BdAnalyticsTabs } from '@/components/analytics/BdAnalyticsTabs';

export default function BdAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <BdAnalyticsTabs />
      {children}
    </div>
  );
}
