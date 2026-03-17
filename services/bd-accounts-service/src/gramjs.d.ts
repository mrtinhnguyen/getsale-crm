// Minimal type declarations for telegram (GramJS) - allow build to pass
// GramJS sendMessage(entity, params) with params.message and optional params.replyTo
declare module 'telegram' {
  export interface SendMessageParams {
    message: string;
    replyTo?: number;
    [key: string]: unknown;
  }

  export class TelegramClient {
    constructor(session: unknown, apiId: number, apiHash: string, opts?: unknown);
    start(params?: unknown): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    invoke(request: unknown): Promise<unknown>;
    getEntity(entity: unknown): Promise<unknown>;
    getMe(): Promise<unknown>;
    getInputEntity(entity: unknown): Promise<unknown>;
    getMessages(entity: unknown, ids: unknown): Promise<unknown[]>;
    downloadMedia(message: unknown, opts?: unknown): Promise<unknown>;
    /** entity: peer id (string/number) or username; params: { message, replyTo? } */
    sendMessage(entity: unknown, params: SendMessageParams): Promise<unknown>;
    addEventHandler(handler: unknown, params?: unknown): void;
    session: unknown;
    [key: string]: unknown;
  }
  export namespace Api {
    const PeerUser: unknown;
    const PeerChat: unknown;
    const PeerChannel: unknown;
    class Message { id: unknown; date?: unknown; [key: string]: unknown; }
    const User: unknown;
    const auth: unknown;
    const TypeMessageEntity: unknown;
    const TypeMessageMedia: unknown;
    const TypeMessageReplyHeader: unknown;
    const TypeMessageFwdHeader: unknown;
    const TypeMessageReactions: unknown;
    const UpdateNewMessage: unknown;
    const UpdateNewChannelMessage: unknown;
  }
}

declare module 'telegram/events' {
  export class NewMessage {
    constructor(opts?: unknown);
  }
  export class Raw {
    constructor(opts?: { types?: unknown[]; func?: (event: unknown) => boolean });
  }
  export class EditedMessage {
    constructor(opts?: unknown);
  }
}

declare module 'telegram/sessions' {
  export class StringSession {
    constructor(session?: string);
    save(): string;
  }
}

declare module 'telegram/Password' {
  export function computeCheck(
    password: unknown,
    passwordHash: unknown
  ): Promise<unknown>;
}
