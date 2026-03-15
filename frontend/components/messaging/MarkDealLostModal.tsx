'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { markDealLost, fetchLeadContext } from '@/lib/api/messaging';
import { reportError } from '@/lib/error-reporter';
import type { LeadContext } from '@/app/dashboard/messaging/types';

interface MarkDealLostModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadContext: LeadContext | null;
  onSuccess: (updatedContext: LeadContext) => void;
}

export function MarkDealLostModal({ isOpen, onClose, leadContext, onSuccess }: MarkDealLostModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!leadContext) return;
    setSubmitting(true);
    try {
      await markDealLost({
        conversation_id: leadContext.conversation_id,
        reason: reason.trim() || undefined,
      });
      const updatedContext = await fetchLeadContext(leadContext.conversation_id);
      onSuccess(updatedContext as LeadContext);
    } catch (e) {
      reportError(e, { component: 'MarkDealLostModal', action: 'markLost' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !submitting && onClose()}
      title={t('messaging.markLostModalTitle', 'Отметить как потеряно')}
      size="sm"
    >
      <div className="px-6 py-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('messaging.markLostConfirm', 'Действие необратимо.')}
        </p>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            {t('messaging.lossReason', 'Причина (необязательно)')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('messaging.lossReasonPlaceholder', 'Например: отказ')}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {submitting ? t('common.saving') : t('messaging.markAsLost', 'Отметить как потеряно')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
