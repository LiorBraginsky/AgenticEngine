/**
 * Minimal transport interface — keeps the seam DOM-free and unit-testable
 * under bun test WITHOUT a live window or global WebSocket.
 *
 * The real renderer wraps browser WebSocket to this shape.
 * Tests inject a fake that implements this shape.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    cb: (ev: { data?: unknown }) => void,
  ): void;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;
