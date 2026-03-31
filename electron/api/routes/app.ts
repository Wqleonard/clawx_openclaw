import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson,sendNoContent } from '../route-utils';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../../utils/openclaw-doctor';

export async function handleAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    // CORS headers are already set by the server middleware.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    ctx.eventBus.addSseClient(res);
    // Send a current-state snapshot immediately so renderer subscribers do not
    // miss lifecycle transitions that happened before the SSE connection opened.
    res.write(`event: gateway:status\ndata: ${JSON.stringify(ctx.gatewayManager.getStatus())}\n\n`);
    return true;
  }

  if (url.pathname === '/api/app/openclaw-doctor' && req.method === 'POST') {
    const body = await parseJsonBody<{ mode?: 'diagnose' | 'fix' }>(req);
    const mode = body.mode === 'fix' ? 'fix' : 'diagnose';
    sendJson(res, 200, mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor());
    return true;
  }

  if (url.pathname === '/api/app/mock-login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ baseUrl?: string; username?: string; password?: string }>(req);
      const rawBase = (body.baseUrl || '').trim();
      if (!rawBase) {
        sendJson(res, 400, { success: false, error: 'baseUrl is required' });
        return true;
      }

      const normalized = rawBase.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
      const loginUrl = new URL('/auth/login', normalized).toString();
      const username = body.username?.trim() || 'southwind';
      const password = body.password?.trim() || '123456';

      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!response.ok) {
        sendJson(res, response.status, {
          success: false,
          status: response.status,
          error: (
            (json && typeof json === 'object' && 'message' in (json as Record<string, unknown>))
              ? String((json as Record<string, unknown>).message)
              : `Mock login failed with status ${response.status}`
          ),
          data: json,
        });
        return true;
      }

      sendJson(res, 200, json ?? { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }
  // OPTIONS is handled by the server middleware; no route-level handler needed.

  return false;
}
