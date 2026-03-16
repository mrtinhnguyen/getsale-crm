export interface BDAccount {
  id: string;
  phone_number: string;
  telegram_id: string;
  is_active: boolean;
  connected_at?: string;
  last_activity?: string;
  created_at: string;
  sync_status?: string;
  sync_progress_done?: number;
  sync_progress_total?: number;
  sync_error?: string;
  is_owner?: boolean;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  bio?: string | null;
  photo_file_id?: string | null;
  display_name?: string | null;
}

export interface Dialog {
  id: string;
  name: string;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageDate?: string;
  isUser: boolean;
  isGroup: boolean;
  isChannel: boolean;
}

export interface FolderWithDialogs {
  id: number;
  title: string;
  emoticon?: string;
  dialogs: Dialog[];
}

export interface SyncChatRow {
  telegram_chat_id: string;
  folder_id: number | null;
  title?: string;
  peer_type?: string;
}
