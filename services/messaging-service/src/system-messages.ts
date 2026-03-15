/**
 * System message constants used in messaging-service database records.
 * English defaults — proper i18n with a locale parameter can be added later.
 */
export const SYSTEM_MESSAGES = {
  SHARED_CHAT_TITLE_TEMPLATE: 'Chat: {{contact_name}}',
  SHARED_CHAT_DEFAULT_CONTACT: 'Contact',
  SHARED_CHAT_FALLBACK_TITLE: 'Shared Chat',
  SHARED_CHAT_CREATED: (title: string) => `[System] Shared chat created: ${title}`,

  DEAL_WON_WITH_AMOUNT: (amount: number, currency: string) =>
    `[System] Deal closed. Amount: ${amount} ${currency}`,
  DEAL_WON: '[System] Deal closed.',
  DEAL_LOST_WITH_REASON: (reason: string) =>
    `[System] Deal lost. Reason: ${reason}`,
  DEAL_LOST: '[System] Deal lost.',

  FILE_PLACEHOLDER: (fileName: string) => `[File: ${fileName}]`,
  MEDIA_PLACEHOLDER: '[Media]',
} as const;
