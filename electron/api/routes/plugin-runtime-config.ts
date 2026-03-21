import type { IncomingMessage, ServerResponse } from 'http';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getSetting } from '../../utils/store';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson, setCorsHeaders } from '../route-utils';

type RuntimePluginId = 'ai-exec-audit' | 'boom-lowpriv-executor';

type RuntimePluginConfig = {
  enabled: boolean;
};

type RuntimeConfigResponse = {
  success: true;
  aiExecAudit: RuntimePluginConfig;
  boomLowprivExecutor: RuntimePluginConfig;
};

const RUNTIME_PLUGIN_IDS: RuntimePluginId[] = ['ai-exec-audit', 'boom-lowpriv-executor'];

function isRuntimePluginId(value: unknown): value is RuntimePluginId {
  return typeof value === 'string' && RUNTIME_PLUGIN_IDS.includes(value as RuntimePluginId);
}

function normalizeEnabled(value: unknown): boolean {
  return value !== false;
}

async function requestGatewayPluginConfig(
  ctx: HostApiContext,
  pluginId: RuntimePluginId,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<RuntimePluginConfig> {
  const status = ctx.gatewayManager.getStatus();
  const port = status.port || 18789;
  const token = await getSetting('gatewayToken');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await proxyAwareFetch(`http://127.0.0.1:${port}/plugins/${pluginId}/config`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`[${pluginId}] ${method} failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as
    | { enabled?: unknown }
    | { config?: { enabled?: unknown } };

  if ('config' in payload && payload.config && typeof payload.config === 'object') {
    return { enabled: normalizeEnabled(payload.config.enabled) };
  }
  return { enabled: normalizeEnabled((payload as { enabled?: unknown }).enabled) };
}

export async function handlePluginRuntimeConfigRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname !== '/api/plugins/runtime-config') {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === 'GET') {
    try {
      const [aiExecAudit, boomLowprivExecutor] = await Promise.all([
        requestGatewayPluginConfig(ctx, 'ai-exec-audit', 'GET'),
        requestGatewayPluginConfig(ctx, 'boom-lowpriv-executor', 'GET'),
      ]);
      const payload: RuntimeConfigResponse = {
        success: true,
        aiExecAudit,
        boomLowprivExecutor,
      };
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ pluginId?: unknown; enabled?: unknown }>(req);
      if (!isRuntimePluginId(body.pluginId) || typeof body.enabled !== 'boolean') {
        sendJson(res, 400, { success: false, error: 'Invalid pluginId or enabled' });
        return true;
      }
      const updated = await requestGatewayPluginConfig(ctx, body.pluginId, 'POST', {
        enabled: body.enabled,
      });
      sendJson(res, 200, { success: true, pluginId: body.pluginId, config: updated });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
  return true;
}

