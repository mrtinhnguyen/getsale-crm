import { useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { setCurrentMessagingChat } from '@/lib/messaging-open-chat';
import {
  fetchContactNotes, fetchContactReminders,
} from '@/lib/api/crm';
import type { Chat, LeadContext } from '../types';
import { MESSAGES_PAGE_SIZE, MAX_CACHED_CHATS } from '../types';
import { getDraftKey, getMessagesCacheKey } from '../utils';
import type { MessagingState } from './useMessagingState';

export function useMessagingData(s: MessagingState) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const convId = s.selectedChat?.conversation_id ?? null;
  const isLead = !!s.selectedChat?.lead_id;
  const isLeadPanelOpen = isLead && s.rightPanelOpen && s.rightPanelTab === 'lead_card';

  // ─── Fetch Accounts ──────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/bd-accounts');
      s.setAccounts(response.data);
      if (response.data.length > 0 && !s.selectedAccountId) {
        s.setSelectedAccountId(response.data[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      s.setLoading(false);
    }
  }, [s.selectedAccountId]);

  // ─── Fetch Chats ─────────────────────────────────────────────────
  const fetchChats = useCallback(async () => {
    if (!s.selectedAccountId) return;
    s.setLoadingChats(true);
    try {
      let chatsFromDB: unknown[] = [];
      try {
        const chatsResponse = await apiClient.get('/api/messaging/chats', {
          params: { channel: 'telegram', bdAccountId: s.selectedAccountId },
        });
        chatsFromDB = chatsResponse.data || [];
      } catch (chatsError) {
        console.warn('Could not fetch chats from messaging service:', chatsError);
      }
      const mapped: Chat[] = (chatsFromDB as Record<string, unknown>[]).map((chat) => {
        const folderIds = Array.isArray(chat.folder_ids) ? (chat.folder_ids as unknown[]).map((x) => Number(x)).filter((n) => !Number.isNaN(n)) : (chat.folder_id != null ? [Number(chat.folder_id)] : []);
        return {
          channel: (chat.channel as string) || 'telegram',
          channel_id: String(chat.channel_id),
          folder_id: chat.folder_id != null ? Number(chat.folder_id) : (folderIds[0] ?? null),
          folder_ids: folderIds.length > 0 ? folderIds : undefined,
          contact_id: chat.contact_id as string | null,
          first_name: chat.first_name as string | null,
          last_name: chat.last_name as string | null,
          email: chat.email as string | null,
          telegram_id: chat.telegram_id as string | null,
          display_name: (chat.display_name as string) ?? null,
          username: (chat.username as string) ?? null,
          name: (chat.name as string) || null,
          peer_type: (chat.peer_type as string) ?? null,
          unread_count: parseInt(String(chat.unread_count)) || 0,
          last_message_at: chat.last_message_at && String(chat.last_message_at).trim() ? String(chat.last_message_at) : '',
          last_message: chat.last_message as string | null,
          conversation_id: (chat.conversation_id as string) ?? null,
          lead_id: (chat.lead_id as string) ?? null,
          lead_stage_name: (chat.lead_stage_name as string) ?? null,
          lead_pipeline_name: (chat.lead_pipeline_name as string) ?? null,
        };
      });
      const byChannelId = new Map<string, Chat>();
      const isIdOnly = (name: string | null, channelId: string) =>
        !name || name.trim() === '' || name === channelId || /^\d+$/.test(String(name).trim());
      for (const chat of mapped) {
        const existing = byChannelId.get(chat.channel_id);
        const chatTime = new Date(chat.last_message_at).getTime();
        const existingTime = existing ? new Date(existing.last_message_at).getTime() : 0;
        const preferNew =
          !existing ||
          chatTime > existingTime ||
          (chatTime === existingTime && isIdOnly(existing.name ?? existing.telegram_id ?? '', existing.channel_id) && !isIdOnly(chat.name ?? chat.telegram_id ?? '', chat.channel_id));
        if (preferNew) {
          const merged = { ...chat };
          if (existing) merged.unread_count = (existing.unread_count || 0) + (merged.unread_count || 0);
          byChannelId.set(chat.channel_id, merged);
        } else if (existing) {
          existing.unread_count = (existing.unread_count || 0) + (chat.unread_count || 0);
        }
      }
      const formattedChats = Array.from(byChannelId.values()).sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return tb - ta;
      });
      s.setChats(formattedChats);
    } catch (error) {
      console.error('Error fetching chats:', error);
      s.setChats([]);
    } finally {
      s.setLoadingChats(false);
    }
  }, [s.selectedAccountId]);
  s.fetchChatsRef.current = fetchChats;

  // ─── Fetch Messages ──────────────────────────────────────────────
  const fetchMessages = useCallback(async (accountId: string, chat: Chat) => {
    s.setLoadingMessages(true);
    s.setMessagesPage(1);
    s.setMessagesTotal(0);
    s.setHistoryExhausted(false);
    try {
      const response = await apiClient.get('/api/messaging/messages', {
        params: { channel: chat.channel, channelId: chat.channel_id, bdAccountId: accountId, page: 1, limit: MESSAGES_PAGE_SIZE },
      });
      const list = response.data.messages || [];
      s.setMessages(list);
      s.setMessagesTotal(response.data.pagination?.total ?? list.length);
      s.setHistoryExhausted(response.data.historyExhausted === true);
      s.setLastLoadedChannelId(chat.channel_id);
    } catch (error) {
      console.error('Error fetching messages:', error);
      s.setMessages([]);
      s.setMessagesTotal(0);
      s.setHistoryExhausted(false);
      s.setLastLoadedChannelId(chat.channel_id);
    } finally {
      s.setLoadingMessages(false);
    }
  }, []);

  // ─── Fetch new leads ─────────────────────────────────────────────
  const fetchNewLeads = useCallback(async () => {
    s.setNewLeadsLoading(true);
    try {
      const res = await apiClient.get<Record<string, unknown>[]>('/api/messaging/new-leads');
      const rows = Array.isArray(res.data) ? res.data : [];
      const mapped: Chat[] = rows.map((r) => {
        const nameStr = (r.display_name as string)?.trim() || [(`${r.first_name || ''}`).trim(), (`${r.last_name || ''}`).trim()].filter(Boolean).join(' ') || (r.username as string) || (r.telegram_id != null ? String(r.telegram_id) : '') || null;
        return {
          channel: (r.channel as string) || 'telegram', channel_id: String(r.channel_id),
          contact_id: (r.contact_id as string) ?? null, first_name: (r.first_name as string) ?? null,
          last_name: (r.last_name as string) ?? null, email: null,
          telegram_id: r.telegram_id != null ? String(r.telegram_id) : null,
          display_name: (r.display_name as string) ?? null, username: (r.username as string) ?? null,
          name: nameStr || null, unread_count: Number(r.unread_count) || 0,
          last_message_at: r.last_message_at != null ? String(r.last_message_at) : '',
          last_message: (r.last_message as string) ?? null,
          conversation_id: (r.conversation_id as string) ?? null, lead_id: (r.lead_id as string) ?? null,
          lead_stage_name: (r.lead_stage_name as string) ?? null, lead_pipeline_name: (r.lead_pipeline_name as string) ?? null,
          bd_account_id: (r.bd_account_id as string) ?? null,
        };
      });
      s.setNewLeads(mapped);
    } catch { s.setNewLeads([]); } finally { s.setNewLeadsLoading(false); }
  }, []);

  // ─── Mark as read ────────────────────────────────────────────────
  const markAsRead = useCallback(async () => {
    if (!s.selectedChat || !s.selectedAccountId) return;
    const chatUnread = s.selectedChat.unread_count ?? 0;
    try {
      await apiClient.post(`/api/messaging/chats/${s.selectedChat.channel_id}/mark-all-read?channel=${s.selectedChat.channel}`);
      s.setChats((prev) => prev.map((c) => c.channel_id === s.selectedChat!.channel_id ? { ...c, unread_count: 0 } : c));
      if (chatUnread > 0) {
        s.setAccounts((prev) => prev.map((a) => a.id === s.selectedAccountId ? { ...a, unread_count: Math.max(0, (a.unread_count ?? 0) - chatUnread) } : a));
      }
    } catch (error) { console.warn('Error marking as read:', error); }
  }, [s.selectedChat, s.selectedAccountId]);

  // ─── Initial load ────────────────────────────────────────────────
  useEffect(() => { fetchAccounts(); }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchAccounts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // ─── URL-based account/chat selection ────────────────────────────
  const urlContactId = searchParams.get('contactId');
  const urlBdAccountId = searchParams.get('bdAccountId');
  const urlOpenChannelId = searchParams.get('open');

  useEffect(() => {
    if (!urlContactId || urlBdAccountId || s.contactIdResolvedRef.current) return;
    s.contactIdResolvedRef.current = true;
    apiClient
      .get<{ bd_account_id: string; channel_id: string }>('/api/messaging/resolve-contact', { params: { contactId: urlContactId } })
      .then(({ data }) => {
        const q = new URLSearchParams();
        q.set('bdAccountId', data.bd_account_id);
        q.set('open', data.channel_id);
        router.replace(`${pathname}?${q.toString()}`);
      })
      .catch(() => { s.contactIdResolvedRef.current = false; });
  }, [urlContactId, urlBdAccountId, pathname, router]);

  useEffect(() => {
    if (!urlBdAccountId || s.accounts.length === 0) return;
    if (s.accounts.some((a) => a.id === urlBdAccountId)) s.setSelectedAccountId(urlBdAccountId);
  }, [urlBdAccountId, s.accounts]);

  useEffect(() => {
    if (s.urlOpenAppliedRef.current || !urlOpenChannelId || !s.selectedAccountId || s.chats.length === 0) return;
    const chat = s.chats.find((c) => c.channel_id === urlOpenChannelId);
    if (chat) {
      s.urlOpenAppliedRef.current = true;
      s.setSelectedChat(chat);
      if (chat.lead_id) {
        s.setRightPanelTab('lead_card');
        s.setRightPanelOpen(true);
        if (chat.conversation_id) s.setLeadPanelOpenByConvId((prev) => ({ ...prev, [chat.conversation_id!]: true }));
      }
    }
  }, [urlOpenChannelId, s.selectedAccountId, s.chats]);

  // ─── Load chats when account selected ────────────────────────────
  useEffect(() => {
    if (!s.selectedAccountId) { s.setChats([]); s.setLoadingChats(false); return; }
    let cancelled = false;
    s.setLoadingChats(true);
    apiClient
      .get<unknown[]>('/api/messaging/chats', { params: { channel: 'telegram', bdAccountId: s.selectedAccountId } })
      .then((res) => {
        if (cancelled) return;
        const chatsFromDB = Array.isArray(res.data) ? res.data : [];
        const mapped: Chat[] = (chatsFromDB as Record<string, unknown>[]).map((chat) => {
          const folderIds = Array.isArray(chat.folder_ids) ? (chat.folder_ids as unknown[]).map((x) => Number(x)).filter((n) => !Number.isNaN(n)) : (chat.folder_id != null ? [Number(chat.folder_id)] : []);
          return {
            channel: (chat.channel as string) || 'telegram', channel_id: String(chat.channel_id),
            folder_id: chat.folder_id != null ? Number(chat.folder_id) : (folderIds[0] ?? null),
            folder_ids: folderIds.length > 0 ? folderIds : undefined,
            contact_id: chat.contact_id as string | null, first_name: chat.first_name as string | null,
            last_name: chat.last_name as string | null, email: chat.email as string | null,
            telegram_id: chat.telegram_id as string | null,
            display_name: (chat.display_name as string) ?? null, username: (chat.username as string) ?? null,
            name: (chat.name as string) || null, peer_type: (chat.peer_type as string) ?? null,
            unread_count: parseInt(String(chat.unread_count), 10) || 0,
            last_message_at: chat.last_message_at && String(chat.last_message_at).trim() ? String(chat.last_message_at) : '',
            last_message: chat.last_message as string | null,
            conversation_id: (chat.conversation_id as string) ?? null, lead_id: (chat.lead_id as string) ?? null,
            lead_stage_name: (chat.lead_stage_name as string) ?? null, lead_pipeline_name: (chat.lead_pipeline_name as string) ?? null,
          };
        });
        const byChannelId = new Map<string, Chat>();
        const isIdOnly = (name: string | null, cid: string) => !name || name.trim() === '' || name === cid || /^\d+$/.test(String(name).trim());
        for (const chat of mapped) {
          const existing = byChannelId.get(chat.channel_id);
          const chatTime = new Date(chat.last_message_at).getTime();
          const existingTime = existing ? new Date(existing.last_message_at).getTime() : 0;
          const preferNew = !existing || chatTime > existingTime || (chatTime === existingTime && isIdOnly(existing.name ?? existing.telegram_id ?? '', existing.channel_id) && !isIdOnly(chat.name ?? chat.telegram_id ?? '', chat.channel_id));
          if (preferNew) {
            const merged = { ...chat };
            if (existing) merged.unread_count = (existing.unread_count || 0) + (merged.unread_count || 0);
            byChannelId.set(chat.channel_id, merged);
          } else if (existing) {
            existing.unread_count = (existing.unread_count || 0) + (chat.unread_count || 0);
          }
        }
        const formattedChats = Array.from(byChannelId.values()).sort((a, b) => {
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return Number.isNaN(ta) ? 1 : Number.isNaN(tb) ? -1 : tb - ta;
        });
        s.setChats(formattedChats);
      })
      .catch((err) => { if (!cancelled) { console.error('Error fetching chats:', err); s.setChats([]); } })
      .finally(() => { if (!cancelled) s.setLoadingChats(false); });
    return () => { cancelled = true; };
  }, [s.selectedAccountId]);

  // ─── Load folders and pinned chats ───────────────────────────────
  useEffect(() => {
    if (!s.selectedAccountId) { s.setFolders([]); s.setSelectedFolderId(0); return; }
    s.setSelectedFolderId(0);
    apiClient.get(`/api/bd-accounts/${s.selectedAccountId}/sync-folders`).then((res) => { s.setFolders(Array.isArray(res.data) ? res.data : []); }).catch(() => s.setFolders([]));
  }, [s.selectedAccountId]);

  useEffect(() => {
    if (!s.selectedAccountId) { s.setPinnedChannelIds([]); return; }
    apiClient.get('/api/messaging/pinned-chats', { params: { bdAccountId: s.selectedAccountId } }).then((res) => {
      const list = Array.isArray(res.data) ? res.data : [];
      s.setPinnedChannelIds(list.map((p: { channel_id: string }) => String(p.channel_id)));
    }).catch(() => s.setPinnedChannelIds([]));
  }, [s.selectedAccountId]);

  // ─── Sync status check ───────────────────────────────────────────
  useEffect(() => {
    const checkSync = async () => {
      if (!s.selectedAccountId) return;
      const selectedAccount = s.accounts.find((a) => a.id === s.selectedAccountId);
      if (selectedAccount?.sync_status === 'completed' || selectedAccount?.is_demo === true) {
        s.setAccountSyncReady(true); s.setAccountSyncProgress(null); s.setAccountSyncError(null); return;
      }
      s.setAccountSyncError(null); s.setLoadingChats(true);
      try {
        const res = await apiClient.get(`/api/bd-accounts/${s.selectedAccountId}/sync-status`);
        const status = res.data?.sync_status;
        const total = Number(res.data?.sync_progress_total ?? 0);
        const done = Number(res.data?.sync_progress_done ?? 0);
        if (status === 'completed') {
          s.setAccountSyncReady(true); s.setAccountSyncProgress(null); await fetchChats();
        } else if (status === 'syncing') {
          s.setAccountSyncReady(false); s.setAccountSyncProgress({ done, total: total || 1 });
          try {
            await apiClient.post(`/api/bd-accounts/${s.selectedAccountId}/sync-start`, {}, { timeout: 20000 });
            const res2 = await apiClient.get(`/api/bd-accounts/${s.selectedAccountId}/sync-status`);
            if (res2.data?.sync_status === 'syncing') {
              s.setAccountSyncProgress({ done: Number(res2.data?.sync_progress_done ?? 0), total: Number(res2.data?.sync_progress_total) || 1 });
            }
          } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string; message?: string } }; message?: string; code?: string };
            const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Ошибка синхронизации';
            s.setAccountSyncError(msg === 'Network Error' || err?.code === 'ECONNABORTED' ? 'Сервер не ответил. Проверьте, что запущены API Gateway и сервис BD Accounts.' : msg);
          }
        } else { s.setAccountSyncReady(false); s.setAccountSyncProgress(null); }
      } catch { s.setAccountSyncReady(false); s.setAccountSyncProgress(null); }
      finally { s.setLoadingChats(false); }
    };
    checkSync();
  }, [s.selectedAccountId, s.accounts]);

  // ─── Poll sync status ────────────────────────────────────────────
  useEffect(() => {
    if (s.accountSyncReady || !s.selectedAccountId) return;
    const poll = async () => {
      try {
        const res = await apiClient.get(`/api/bd-accounts/${s.selectedAccountId}/sync-status`);
        const status = res.data?.sync_status;
        if (status === 'completed') {
          s.setAccountSyncReady(true); s.setAccountSyncProgress(null); s.setAccountSyncError(null);
          await fetchChats(); await fetchAccounts(); return;
        }
        if (status === 'syncing') s.setAccountSyncProgress({ done: Number(res.data?.sync_progress_done ?? 0), total: Number(res.data?.sync_progress_total) || 1 });
      } catch { /* ignore */ }
    };
    const interval = setInterval(poll, 2000);
    s.pollSyncStatusRef.current = interval;
    return () => { if (s.pollSyncStatusRef.current) { clearInterval(s.pollSyncStatusRef.current); s.pollSyncStatusRef.current = null; } };
  }, [s.selectedAccountId, s.accountSyncReady]);

  // ─── Messages cache and chat switch ──────────────────────────────
  useEffect(() => {
    if (s.selectedChat && s.selectedAccountId) {
      const key = getMessagesCacheKey(s.selectedAccountId, s.selectedChat.channel_id);
      const prevKey = s.prevChatCacheKeyRef.current;
      if (prevKey && prevKey !== key) {
        const order = s.messagesCacheOrderRef.current;
        const cache = s.messagesCacheRef.current;
        cache.set(prevKey, { messages: s.messages, messagesTotal: s.messagesTotal, messagesPage: s.messagesPage, historyExhausted: s.historyExhausted });
        const idx = order.indexOf(prevKey);
        if (idx !== -1) order.splice(idx, 1);
        order.push(prevKey);
        while (order.length > MAX_CACHED_CHATS) { const evict = order.shift()!; cache.delete(evict); }
      }
      s.prevChatCacheKeyRef.current = key;
      const cached = s.messagesCacheRef.current.get(key);
      if (cached) {
        if (cached.messages.length === 0 && !cached.historyExhausted) {
          s.setMessages([]); fetchMessages(s.selectedAccountId, s.selectedChat);
        } else {
          s.setMessages(cached.messages); s.setMessagesTotal(cached.messagesTotal); s.setMessagesPage(cached.messagesPage);
          s.setHistoryExhausted(cached.historyExhausted); s.setLoadingMessages(false); s.setPrependedCount(0);
          s.setLastLoadedChannelId(s.selectedChat.channel_id);
          markAsRead(); return;
        }
        markAsRead(); return;
      }
      s.setMessages([]); fetchMessages(s.selectedAccountId, s.selectedChat); markAsRead();
    } else {
      s.prevChatCacheKeyRef.current = null; s.setMessages([]); s.setLastLoadedChannelId(null);
    }
  }, [s.selectedChat?.channel_id, s.selectedChat?.channel, s.selectedAccountId]);

  // ─── Draft handling ──────────────────────────────────────────────
  useEffect(() => {
    const prev = s.prevChatRef.current;
    if (prev) { try { localStorage.setItem(getDraftKey(prev.accountId, prev.chatId), s.newMessageRef.current); } catch {} }
    s.setReplyToMessage(null);
    if (s.selectedAccountId && s.selectedChat) {
      try { const draft = localStorage.getItem(getDraftKey(s.selectedAccountId, s.selectedChat.channel_id)) || ''; s.setNewMessage(draft); } catch {}
      s.prevChatRef.current = { accountId: s.selectedAccountId, chatId: s.selectedChat.channel_id };
    } else { s.prevChatRef.current = null; }
  }, [s.selectedAccountId, s.selectedChat?.channel_id]);

  useEffect(() => {
    if (!s.selectedChat) return;
    s.setNewMessage(s.draftByChannel[s.selectedChat.channel_id]?.text ?? '');
  }, [s.selectedChat?.channel_id]);

  useEffect(() => { s.setChannelNeedsRefresh(null); }, [s.selectedAccountId]);

  useEffect(() => {
    if (s.selectedAccountId && s.selectedChat) { setCurrentMessagingChat(s.selectedAccountId, s.selectedChat.channel_id); }
    else { setCurrentMessagingChat(null, null); }
    return () => setCurrentMessagingChat(null, null);
  }, [s.selectedAccountId, s.selectedChat?.channel_id]);

  // ─── Draft save to Telegram ──────────────────────────────────────
  useEffect(() => {
    if (!s.selectedAccountId || !s.selectedChat) return;
    const channelId = s.selectedChat.channel_id;
    const text = s.newMessage.trim();
    const replyToMsgId = s.replyToMessage?.telegram_message_id ? Number(s.replyToMessage.telegram_message_id) : undefined;
    if (s.draftSaveTimerRef.current) clearTimeout(s.draftSaveTimerRef.current);
    s.draftSaveTimerRef.current = setTimeout(() => {
      s.draftSaveTimerRef.current = null;
      apiClient.post(`/api/bd-accounts/${s.selectedAccountId}/draft`, { channelId, text, replyToMsgId }).catch(() => {});
    }, 1500);
    return () => { if (s.draftSaveTimerRef.current) { clearTimeout(s.draftSaveTimerRef.current); s.draftSaveTimerRef.current = null; } };
  }, [s.selectedAccountId, s.selectedChat?.channel_id, s.newMessage, s.replyToMessage?.telegram_message_id]);

  // ─── New leads ───────────────────────────────────────────────────
  useEffect(() => { if (s.activeSidebarSection === 'new-leads') fetchNewLeads(); }, [s.activeSidebarSection, fetchNewLeads]);

  // ─── Lead context ────────────────────────────────────────────────
  useEffect(() => {
    const leadId = s.selectedChat?.lead_id;
    if (!leadId || !isLeadPanelOpen) { s.setLeadContext(null); s.setLeadContextError(null); return; }
    let cancelled = false;
    s.setLeadContextLoading(true); s.setLeadContextError(null);
    const url = convId
      ? `/api/messaging/conversations/${convId}/lead-context`
      : `/api/messaging/lead-context-by-lead/${leadId}`;
    apiClient.get<LeadContext>(url)
      .then((res) => { if (!cancelled && res.data) s.setLeadContext(res.data); })
      .catch((err: { response?: { data?: { error?: string } } }) => { if (!cancelled) s.setLeadContextError(err?.response?.data?.error ?? 'Failed to load lead context'); })
      .finally(() => { if (!cancelled) s.setLeadContextLoading(false); });
    return () => { cancelled = true; };
  }, [convId, s.selectedChat?.lead_id, isLeadPanelOpen]);

  useEffect(() => {
    if (!s.leadContext?.contact_id) { s.setLeadNotes([]); s.setLeadReminders([]); return; }
    const cid = s.leadContext.contact_id;
    fetchContactNotes(cid).then(s.setLeadNotes).catch(() => s.setLeadNotes([]));
    fetchContactReminders(cid).then(s.setLeadReminders).catch(() => s.setLeadReminders([]));
  }, [s.leadContext?.contact_id]);

  // ─── Textarea autosize ───────────────────────────────────────────
  useEffect(() => {
    const el = s.messageInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 120)}px`;
  }, [s.newMessage]);

  return {
    convId, isLead, isLeadPanelOpen,
    fetchAccounts, fetchChats, fetchMessages, fetchNewLeads, markAsRead,
  };
}
