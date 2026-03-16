import { z } from 'zod';

/** Zod schemas for sync routes (Q22: extracted from sync.ts). */

export const SyncChatItemSchema = z.object({
  id: z.string().optional(),
  telegram_chat_id: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  folderId: z.number().optional().nullable(),
  folderIds: z.array(z.number()).optional(),
  isChannel: z.boolean().optional(),
  isGroup: z.boolean().optional(),
}).refine((d) => (d.id ?? d.telegram_chat_id ?? '').toString().trim().length > 0, { message: 'id or telegram_chat_id required' });

export const SyncChatsBodySchema = z.object({
  chats: z.array(SyncChatItemSchema).min(0).max(2000),
});

export const SyncFoldersOrderSchema = z.object({
  order: z.array(z.union([z.string(), z.number()])).min(1).max(500),
});

export const SyncFolderCustomSchema = z.object({
  folder_title: z.string().max(12).trim().optional(),
  icon: z.string().max(20).trim().optional().nullable(),
});

export const SyncFolderPatchSchema = z.object({
  icon: z.string().max(20).trim().nullable().optional(),
  folder_title: z.string().max(12).trim().optional(),
}).refine((d) => d.icon !== undefined || d.folder_title !== undefined, { message: 'At least one of icon or folder_title required' });

export const ResolveChatsSchema = z.object({
  inputs: z.array(z.string().min(1).max(512)).max(20).optional(),
});

export const ParseResolveSchema = z.object({
  sources: z.array(z.string().min(1).max(512)).max(20).optional(),
});

export const ChatFolderPatchSchema = z.object({
  folder_ids: z.array(z.coerce.number().int().min(0)).optional(),
  folder_id: z.coerce.number().int().min(0).optional().nullable(),
});

export const SyncFolderItemSchema = z.object({
  folderId: z.number().optional(),
  folder_id: z.number().optional(),
  folderTitle: z.string().max(200).trim().optional(),
  folder_title: z.string().max(200).trim().optional(),
  is_user_created: z.boolean().optional(),
  isUserCreated: z.boolean().optional(),
  icon: z.string().max(20).trim().optional().nullable(),
});

export const SyncFoldersBodySchema = z.object({
  folders: z.array(SyncFolderItemSchema).min(0).max(500),
  extraChats: z.array(SyncChatItemSchema).max(1000).optional(),
});
