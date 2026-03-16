'use client';

import { useEffect, useState, useRef } from 'react';
import { apiClient } from '@/lib/api/client';
import { getAccountInitials } from '../utils';
import type { BDAccount } from '../types';

interface AccountAvatarProps {
  accountId: string;
  account: BDAccount;
  className?: string;
}

export function AccountAvatar({ accountId, account, className = 'w-12 h-12' }: AccountAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);
  const mounted = useRef(true);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    apiClient
      .get(`/api/bd-accounts/${accountId}/avatar`, { responseType: 'blob' })
      .then((res) => {
        if (mounted.current && res.data instanceof Blob && res.data.size > 0) {
          const u = URL.createObjectURL(res.data);
          blobUrlRef.current = u;
          setSrc(u);
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setSrc(null);
    };
  }, [accountId]);

  const initials = getAccountInitials(account);

  if (src) {
    return <img src={src} alt="" className={`rounded-full object-cover bg-gray-100 dark:bg-gray-800 ${className}`} />;
  }
  return (
    <div className={`rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-300 font-semibold text-sm ${className}`}>
      {initials}
    </div>
  );
}
