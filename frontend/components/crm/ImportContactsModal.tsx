'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp } from 'lucide-react';
import { importContactsFromCsv } from '@/lib/api/crm';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface ImportContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportContactsModal({ isOpen, onClose, onSuccess }: ImportContactsModalProps) {
  const { t } = useTranslation();
  const [fileContent, setFileContent] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ created: number; updated: number; errors: { row: number; message: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    onClose();
    setResult(null);
    setFileContent('');
  };

  const handleImport = async () => {
    if (!fileContent) return;
    setLoading(true);
    try {
      const mapping: Record<string, number> = {};
      Object.entries(columnMapping).forEach(([colIdx, field]) => {
        if (field) mapping[field] = parseInt(colIdx, 10);
      });
      const res = await importContactsFromCsv({
        content: fileContent,
        hasHeader,
        mapping: Object.keys(mapping).length ? mapping : undefined,
      });
      setResult(res);
      if (res.created > 0 || res.updated > 0) onSuccess();
    } catch (err) {
      setResult({ created: 0, updated: 0, errors: [{ row: 0, message: String(err) }] });
    } finally {
      setLoading(false);
    }
  };

  const lines = fileContent ? fileContent.split('\n').filter((l) => l.trim()) : [];
  const firstRow = lines[hasHeader ? 1 : 0];
  const colCount = firstRow ? firstRow.split(',').length : 0;

  const fieldOpts = [
    { value: '', label: t('crm.importSkip') },
    { value: 'firstName', label: t('crm.importFirstName') },
    { value: 'lastName', label: t('crm.importLastName') },
    { value: 'email', label: t('crm.importEmail') },
    { value: 'phone', label: t('crm.importPhone') },
    { value: 'telegramId', label: t('crm.importTelegramId') },
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('crm.importTitle')} size="md">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('crm.importContactsHint')}</p>

        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          id="crm-import-csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const text = String(reader.result ?? '');
              setFileContent(text);
              setResult(null);
              const csvLines = text.split('\n').filter((l) => l.trim());
              const first = csvLines[0];
              if (first) {
                const cols = first.split(',').length;
                const defaultMap: Record<number, string> = {};
                const defaults = ['firstName', 'lastName', 'email', 'phone', 'telegramId'];
                for (let i = 0; i < cols; i++) defaultMap[i] = defaults[i] ?? '';
                setColumnMapping(defaultMap);
              }
            };
            reader.readAsText(file, 'UTF-8');
            e.target.value = '';
          }}
        />
        <label
          htmlFor="crm-import-csv"
          className="inline-flex items-center justify-center font-medium rounded-lg border border-border hover:bg-accent text-foreground px-4 py-2 text-sm cursor-pointer transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <FileUp className="w-4 h-4 mr-2" />
          {fileContent ? t('crm.importChangeFile') : t('crm.importSelectFile')}
        </label>

        {fileContent && (
          <>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-foreground">{t('crm.importHasHeader')}</span>
            </label>
            {colCount > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">{t('crm.importMapping')}</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Array.from({ length: colCount }, (_, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t('crm.importColumn', { num: i + 1 })}</span>
                      <select
                        value={columnMapping[i] ?? ''}
                        onChange={(e) => setColumnMapping((prev) => ({ ...prev, [i]: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm"
                      >
                        {fieldOpts.map((o) => (
                          <option key={o.value || 'skip'} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {result && (
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <p className="text-foreground">{t('crm.importCreated')}: {result.created}, {t('crm.importUpdated')}: {result.updated}</p>
            {result.errors.length > 0 && (
              <p className="text-destructive mt-1">
                {t('crm.importErrors')}: {result.errors.length} (строки: {result.errors.slice(0, 5).map((e) => e.row).join(', ')}{result.errors.length > 5 ? '…' : ''})
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={handleClose}>{t('common.close')}</Button>
          <Button disabled={!fileContent || loading} onClick={handleImport}>
            {loading ? t('common.loading') : t('crm.importRun')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
