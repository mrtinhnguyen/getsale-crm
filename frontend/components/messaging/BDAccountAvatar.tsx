'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { blobUrlCache, avatarAccountKey } from '@/lib/cache/blob-url-cache';
import type { BDAccount } from '@/app/dashboard/messaging/types';
import { getAccountInitials } from '@/app/dashboard/messaging/utils';

interface BDAccountAvatarProps {
  accountId: string;
  account: BDAccount;
  className?: string;
}

function BDAccountAvatarInner({ accountId, account, className = 'w-10 h-10' }: BDAccountAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);
  const mounted = useRef(true);
  const key = avatarAccountKey(accountId);

  useEffect(() => {
    mounted.current = true;
    const cached = blobUrlCache.get(key);
    if (cached) {
      setSrc(cached);
      return () => { mounted.current = false; setSrc(null); };
    }
    apiClient
      .get(`/api/bd-accounts/${accountId}/avatar`, { responseType: 'blob' })
      .then((res) => {
        if (mounted.current && res.data instanceof Blob && res.data.size > 0) {
          const u = URL.createObjectURL(res.data);
          blobUrlCache.set(key, u);
          setSrc(u);
        }
      })
      .catch(() => {});
    return () => { mounted.current = false; setSrc(null); };
  }, [accountId, key]);

  const initials = getAccountInitials(account);
  if (src) {
    return <img src={src} alt="" className={`rounded-full object-cover bg-muted shrink-0 ${className}`} />;
  }
  return (
    <div className={`rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold text-sm shrink-0 ${className}`}>
      {initials}
    </div>
  );
}

export const BDAccountAvatar = React.memo(BDAccountAvatarInner);
