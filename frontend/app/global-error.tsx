'use client';

import { useEffect } from 'react';

/**
 * Catches errors that bubble past the root layout (e.g. root layout itself throws).
 * Cannot use i18n or design tokens because it replaces the entire <html> tree.
 */
export default function RootGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RootGlobalError]', error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          color: '#111827',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            padding: 32,
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            backgroundColor: '#fff',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              fontSize: 36,
              marginBottom: 12,
            }}
          >
            &#9888;
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Что-то пошло не так
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
            Критическая ошибка приложения. Попробуйте обновить страницу.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Попробовать снова
          </button>
        </div>
      </body>
    </html>
  );
}
