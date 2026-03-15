/** DB row interfaces for messaging-service queries. */

export interface LeadContextRow {
  conversation_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  became_lead_at: Date | string | null;
  contact_id: string | null;
  bd_account_id: string | null;
  channel_id: string | null;
  shared_chat_created_at: Date | null;
  shared_chat_channel_id: string | number | null;
  shared_chat_invite_link: string | null;
  won_at: Date | null;
  revenue_amount: number | string | null;
  lost_at: Date | null;
  loss_reason: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  responsible_id: string | null;
  pipeline_name: string | null;
  stage_name: string | null;
  responsible_email: string | null;
  contact_name: string | null;
  contact_telegram_id: string | number | null;
  contact_username: string | null;
  campaign_name: string | null;
  company_name: string | null;
}

export interface TimelineRow {
  type: string;
  created_at: Date | string;
  to_stage_name: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MessageRow {
  id: string;
  organization_id: string;
  bd_account_id: string | null;
  channel: string;
  channel_id: string;
  contact_id: string | null;
  direction: string;
  content: string;
  status: string;
  unread: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  telegram_message_id: string | number | null;
  reply_to_telegram_id: string | null;
  telegram_media: Record<string, unknown> | null;
  telegram_entities: Array<Record<string, unknown>> | null;
  telegram_date: Date | string | null;
  telegram_extra: Record<string, unknown> | null;
  reactions: Record<string, number> | null;
  our_reactions: string[] | null;
  metadata: Record<string, unknown> | null;
  sender_name?: string | null;
}

export interface HistoryExhaustedRow {
  history_exhausted: boolean;
}

export interface PinnedChatRow {
  channel_id: string;
  order_index: number;
}

export type QueryParam = string | number | boolean | null | Date | string[];
