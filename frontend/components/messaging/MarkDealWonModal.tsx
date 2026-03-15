'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { markDealWon, fetchLeadContext } from '@/lib/api/messaging';
import { reportError } from '@/lib/error-reporter';
import type { LeadContext } from '@/app/dashboard/messaging/types';

interface MarkDealWonModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadContext: LeadContext | null;
  onSuccess: (updatedContext: LeadContext) => void;
}

export function MarkDealWonModal({ isOpen, onClose, leadContext, onSuccess }: MarkDealWonModalProps) {
  const { t } = useTranslation();
  const [revenue, setRevenue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setRevenue('');
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!leadContext) return;
    const amount = revenue.trim() ? parseFloat(revenue.replace(',', '.')) : null;
    if (amount != null && (Number.isNaN(amount) || amount < 0)) return;
    setSubmitting(true);
    try {
      await markDealWon({
        conversation_id: leadContext.conversation_id,
        ...(amount != null && !Number.isNaN(amount) ? { revenue_amount: amount } : {}),
      });
      const updatedContext = await fetchLeadContext(leadContext.conversation_id);
      onSuccess(updatedContext as LeadContext);
    } catch (e) {
      reportError(e, { component: 'MarkDealWonModal', action: 'markWon' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !submitting && onClose()}
      title={t('messaging.markWonModalTitle', 'Закрыть сделку')}
      size="sm"
    >
      <div className="px-6 py-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('messaging.markWonConfirm', 'Действие необратимо.')}
        </p>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            {t('messaging.revenueAmount', 'Сумма сделки')}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground"
          />
          <p className="text-xs text-muted-foreground mt-1">€</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {submitting ? t('common.saving') : t('messaging.closeDeal', 'Закрыть сделку')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
