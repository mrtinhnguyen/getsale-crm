import { useState, useRef, useEffect, useCallback } from 'react';
import { getPersistedRightPanelTab } from '@/components/messaging/RightWorkspacePanel';
import type {
  BDAccount, Chat, Message, SyncFolder, LeadContext,
  MessagesCacheEntry, Note, Reminder, RightPanelTab,
} from '../types';
import { STORAGE_KEYS } from '../types';

export function useMessagingState() {
  const [accounts, setAccounts] = useState<BDAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [lastLoadedChannelId, setLastLoadedChannelId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [prependedCount, setPrependedCount] = useState(0);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [showCommandsMenu, setShowCommandsMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [accountSyncReady, setAccountSyncReady] = useState<boolean>(true);
  const [accountSyncProgress, setAccountSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [accountSyncError, setAccountSyncError] = useState<string | null>(null);
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [forwardModal, setForwardModal] = useState<Message | null>(null);
  const [forwardingToChatId, setForwardingToChatId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [folders, setFolders] = useState<SyncFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number>(0);
  const [folderIconPickerId, setFolderIconPickerId] = useState<string | null>(null);
  const [syncFoldersPushing, setSyncFoldersPushing] = useState(false);
  const [showFolderManageModal, setShowFolderManageModal] = useState(false);
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [pinnedChannelIds, setPinnedChannelIds] = useState<string[]>([]);
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [accountContextMenu, setAccountContextMenu] = useState<{ x: number; y: number; account: BDAccount } | null>(null);
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [createSharedChatModalOpen, setCreateSharedChatModalOpen] = useState(false);
  const [createSharedChatTitle, setCreateSharedChatTitle] = useState('');
  const [createSharedChatExtraUsernames, setCreateSharedChatExtraUsernames] = useState<string[]>([]);
  const [createSharedChatNewUsername, setCreateSharedChatNewUsername] = useState('');
  const [createSharedChatSubmitting, setCreateSharedChatSubmitting] = useState(false);
  const [markWonModalOpen, setMarkWonModalOpen] = useState(false);
  const [markWonRevenue, setMarkWonRevenue] = useState('');
  const [markWonSubmitting, setMarkWonSubmitting] = useState(false);
  const [markLostModalOpen, setMarkLostModalOpen] = useState(false);
  const [markLostReason, setMarkLostReason] = useState('');
  const [markLostSubmitting, setMarkLostSubmitting] = useState(false);
  const [leadCardModalOpen, setLeadCardModalOpen] = useState(false);
  const [typingChannelId, setTypingChannelId] = useState<string | null>(null);
  const [draftByChannel, setDraftByChannel] = useState<Record<string, { text: string; replyToMsgId?: number }>>({});
  const [userStatusByUserId, setUserStatusByUserId] = useState<Record<string, { status: string; expires?: number }>>({});
  const [readOutboxMaxIdByChannel, setReadOutboxMaxIdByChannel] = useState<Record<string, number>>({});
  const [contactDisplayOverrides, setContactDisplayOverrides] = useState<Record<string, { firstName?: string; lastName?: string; usernames?: string[]; phone?: string }>>({});
  const [channelNeedsRefresh, setChannelNeedsRefresh] = useState<string | null>(null);
  const [editDisplayNameValue, setEditDisplayNameValue] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [showChatHeaderMenu, setShowChatHeaderMenu] = useState(false);
  const [addToFunnelFromChat, setAddToFunnelFromChat] = useState<{
    contactId: string; contactName: string; leadTitle?: string; bdAccountId?: string; channel?: string; channelId?: string;
  } | null>(null);
  const [mediaViewer, setMediaViewer] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [leadPanelOpenByConvId, setLeadPanelOpenByConvId] = useState<Record<string, boolean>>({});
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab | null>(null);
  const [leadContext, setLeadContext] = useState<LeadContext | null>(null);
  const [leadContextLoading, setLeadContextLoading] = useState(false);
  const [leadContextError, setLeadContextError] = useState<string | null>(null);
  const [leadStagePatching, setLeadStagePatching] = useState(false);
  const [leadNotes, setLeadNotes] = useState<Note[]>([]);
  const [leadReminders, setLeadReminders] = useState<Reminder[]>([]);
  const [leadNoteText, setLeadNoteText] = useState('');
  const [leadRemindAt, setLeadRemindAt] = useState('');
  const [leadRemindTitle, setLeadRemindTitle] = useState('');
  const [addingLeadNote, setAddingLeadNote] = useState(false);
  const [addingLeadReminder, setAddingLeadReminder] = useState(false);
  const [activeSidebarSection, setActiveSidebarSection] = useState<'new-leads' | 'telegram'>('telegram');
  const [newLeads, setNewLeads] = useState<Chat[]>([]);
  const [newLeadsLoading, setNewLeadsLoading] = useState(false);
  const [chatTypeFilter, setChatTypeFilter] = useState<'all' | 'personal' | 'groups'>('all');

  useEffect(() => {
    const t = getPersistedRightPanelTab();
    if (t) setRightPanelTab(t);
  }, []);

  const [accountsPanelCollapsed, setAccountsPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(STORAGE_KEYS.accountsPanel) === 'true'; } catch { return false; }
  });
  const [chatsPanelCollapsed, setChatsPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(STORAGE_KEYS.chatsPanel) === 'true'; } catch { return false; }
  });
  const [hideEmptyFolders, setHideEmptyFoldersState] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(STORAGE_KEYS.hideEmptyFolders) !== 'false'; } catch { return true; }
  });
  const setHideEmptyFolders = useCallback((v: boolean) => {
    setHideEmptyFoldersState(v);
    try { localStorage.setItem(STORAGE_KEYS.hideEmptyFolders, String(v)); } catch {}
  }, []);
  const setAccountsCollapsed = useCallback((v: boolean) => {
    setAccountsPanelCollapsed(v);
    try { localStorage.setItem(STORAGE_KEYS.accountsPanel, String(v)); } catch {}
  }, []);
  const setChatsCollapsed = useCallback((v: boolean) => {
    setChatsPanelCollapsed(v);
    try { localStorage.setItem(STORAGE_KEYS.chatsPanel, String(v)); } catch {}
  }, []);

  // ─── Refs ───────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopSentinelRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const hasUserScrolledUpRef = useRef(false);
  const loadOlderLastCallRef = useRef<number>(0);
  const skipScrollToBottomAfterPrependRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const scrollToBottomRef = useRef<() => void>(() => {});
  const virtuosoRef = useRef<unknown>(null);
  const messagesCacheRef = useRef<Map<string, MessagesCacheEntry>>(new Map());
  const messagesCacheOrderRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatHeaderMenuRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const prevChatRef = useRef<{ accountId: string; chatId: string } | null>(null);
  const newMessageRef = useRef(newMessage);
  newMessageRef.current = newMessage;
  const fetchChatsRef = useRef<(() => Promise<void>) | null>(null);
  const urlOpenAppliedRef = useRef(false);
  const contactIdResolvedRef = useRef(false);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollSyncStatusRef = useRef<NodeJS.Timeout | null>(null);
  const prevChatCacheKeyRef = useRef<string | null>(null);

  return {
    accounts, setAccounts,
    selectedAccountId, setSelectedAccountId,
    chats, setChats,
    selectedChat, setSelectedChat,
    messages, setMessages,
    newMessage, setNewMessage,
    loading, setLoading,
    loadingChats, setLoadingChats,
    loadingMessages, setLoadingMessages,
    sendingMessage, setSendingMessage,
    loadingOlder, setLoadingOlder,
    messagesPage, setMessagesPage,
    messagesTotal, setMessagesTotal,
    historyExhausted, setHistoryExhausted,
    lastLoadedChannelId, setLastLoadedChannelId,
    accountSearch, setAccountSearch,
    chatSearch, setChatSearch,
    prependedCount, setPrependedCount,
    showScrollToBottomButton, setShowScrollToBottomButton,
    showCommandsMenu, setShowCommandsMenu,
    showAttachMenu, setShowAttachMenu,
    pendingFile, setPendingFile,
    isRecording, setIsRecording,
    accountSyncReady, setAccountSyncReady,
    accountSyncProgress, setAccountSyncProgress,
    accountSyncError, setAccountSyncError,
    messageContextMenu, setMessageContextMenu,
    replyToMessage, setReplyToMessage,
    forwardModal, setForwardModal,
    forwardingToChatId, setForwardingToChatId,
    dragOverFolderId, setDragOverFolderId,
    deletingMessageId, setDeletingMessageId,
    folders, setFolders,
    selectedFolderId, setSelectedFolderId,
    folderIconPickerId, setFolderIconPickerId,
    syncFoldersPushing, setSyncFoldersPushing,
    showFolderManageModal, setShowFolderManageModal,
    broadcastModalOpen, setBroadcastModalOpen,
    pinnedChannelIds, setPinnedChannelIds,
    chatContextMenu, setChatContextMenu,
    accountContextMenu, setAccountContextMenu,
    showEditNameModal, setShowEditNameModal,
    createSharedChatModalOpen, setCreateSharedChatModalOpen,
    createSharedChatTitle, setCreateSharedChatTitle,
    createSharedChatExtraUsernames, setCreateSharedChatExtraUsernames,
    createSharedChatNewUsername, setCreateSharedChatNewUsername,
    createSharedChatSubmitting, setCreateSharedChatSubmitting,
    markWonModalOpen, setMarkWonModalOpen,
    markWonRevenue, setMarkWonRevenue,
    markWonSubmitting, setMarkWonSubmitting,
    markLostModalOpen, setMarkLostModalOpen,
    markLostReason, setMarkLostReason,
    markLostSubmitting, setMarkLostSubmitting,
    leadCardModalOpen, setLeadCardModalOpen,
    typingChannelId, setTypingChannelId,
    draftByChannel, setDraftByChannel,
    userStatusByUserId, setUserStatusByUserId,
    readOutboxMaxIdByChannel, setReadOutboxMaxIdByChannel,
    contactDisplayOverrides, setContactDisplayOverrides,
    channelNeedsRefresh, setChannelNeedsRefresh,
    editDisplayNameValue, setEditDisplayNameValue,
    savingDisplayName, setSavingDisplayName,
    showChatHeaderMenu, setShowChatHeaderMenu,
    addToFunnelFromChat, setAddToFunnelFromChat,
    mediaViewer, setMediaViewer,
    leadPanelOpenByConvId, setLeadPanelOpenByConvId,
    rightPanelOpen, setRightPanelOpen,
    rightPanelTab, setRightPanelTab,
    leadContext, setLeadContext,
    leadContextLoading, setLeadContextLoading,
    leadContextError, setLeadContextError,
    leadStagePatching, setLeadStagePatching,
    leadNotes, setLeadNotes,
    leadReminders, setLeadReminders,
    leadNoteText, setLeadNoteText,
    leadRemindAt, setLeadRemindAt,
    leadRemindTitle, setLeadRemindTitle,
    addingLeadNote, setAddingLeadNote,
    addingLeadReminder, setAddingLeadReminder,
    activeSidebarSection, setActiveSidebarSection,
    newLeads, setNewLeads,
    newLeadsLoading, setNewLeadsLoading,
    chatTypeFilter, setChatTypeFilter,
    accountsPanelCollapsed, setAccountsCollapsed,
    chatsPanelCollapsed, setChatsCollapsed,
    hideEmptyFolders, setHideEmptyFolders,
    // Refs
    messagesEndRef, messagesTopSentinelRef, messagesScrollRef,
    scrollRestoreRef, hasUserScrolledUpRef, loadOlderLastCallRef,
    skipScrollToBottomAfterPrependRef, isAtBottomRef, scrollToBottomRef,
    virtuosoRef, messagesCacheRef, messagesCacheOrderRef,
    fileInputRef, chatHeaderMenuRef, messageInputRef,
    prevChatRef, newMessageRef, fetchChatsRef,
    urlOpenAppliedRef, contactIdResolvedRef,
    typingClearTimerRef, draftSaveTimerRef,
    pollSyncStatusRef, prevChatCacheKeyRef,
  };
}

export type MessagingState = ReturnType<typeof useMessagingState>;
