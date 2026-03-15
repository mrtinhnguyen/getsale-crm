'use client';

/**
 * @deprecated SSE real-time channel removed — consolidated to WebSocket (Socket.IO).
 * All events previously delivered via SSE now arrive through the WebSocket `event` event.
 * Use `useWebSocketContext()` from `@/lib/contexts/websocket-context` instead.
 */

type EventHandler = (data: Record<string, unknown>) => void;

interface EventsStreamContextValue {
  subscribe: (eventType: string, handler: EventHandler) => () => void;
  isConnected: boolean;
}

/** @deprecated Use useWebSocketContext() instead. */
export function useEventsStream(): EventsStreamContextValue {
  return {
    subscribe: () => () => {},
    isConnected: false,
  };
}
