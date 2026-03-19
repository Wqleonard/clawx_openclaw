import { invokeIpc } from '@/lib/api-client';

type ClientLogLevel = 'info' | 'warn' | 'error';

type ClientLogPayload = {
  source: string;
  message: string;
  data?: Record<string, unknown>;
};

export function logClientEvent(level: ClientLogLevel, payload: ClientLogPayload): void {
  try {
    void invokeIpc('log:clientEvent', {
      level,
      source: payload.source,
      message: payload.message,
      data: payload.data ?? null,
      ts: new Date().toISOString(),
    });
  } catch {
    // Keep diagnostics best-effort and never break UI behavior.
  }
}
