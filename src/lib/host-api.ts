import { invokeIpc } from '@/lib/api-client';
import { trackUiEvent } from './telemetry';
import { normalizeAppError } from './error-model';

const HOST_API_PORT = 3210;
const HOST_API_BASE = `http://127.0.0.1:${HOST_API_PORT}`;

/** Cached Host API auth token, fetched once from the main process via IPC. */
let cachedHostApiToken: string | null = null;

async function getHostApiToken(): Promise<string> {
  if (cachedHostApiToken) {
    return cachedHostApiToken;
  }

  let lastError: unknown = null;
  // Host API token is generated when main-process host API server starts.
  // During early renderer boot it may still be empty, so retry briefly.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const token = await invokeIpc<string>('hostapi:token');
      if (typeof token === 'string' && token.length > 0) {
        cachedHostApiToken = token;
        return token;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(
    lastError instanceof Error
      ? `Host API token unavailable via IPC: ${lastError.message}`
      : 'Host API token unavailable via IPC (empty token or channel error)'
  );
}

type HostApiProxyResponse = {
  ok?: boolean;
  data?: {
    status?: number;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
  error?: { message?: string } | string;
  // backward compatibility fields
  success: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

type HostApiProxyData = {
  status?: number;
  ok?: boolean;
  json?: unknown;
  text?: string;
};

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore body parse failure
    }
    throw normalizeAppError(new Error(message), {
      source: 'browser-fallback',
      status: response.status,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function resolveProxyErrorMessage(error: HostApiProxyResponse['error']): string {
  return typeof error === 'string'
    ? error
    : (error?.message || 'Host API proxy request failed');
}

function parseUnifiedProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.ok) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  const data: HostApiProxyData = response.data ?? {};
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy',
    durationMs: Date.now() - startedAt,
    status: data.status ?? 200,
  });

  if (data.status === 204) return undefined as T;
  if (data.json !== undefined) return data.json as T;
  return data.text as T;
}

function parseLegacyProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.success) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  if (!response.ok) {
    const message = response.text
      || (typeof response.json === 'object' && response.json != null && 'error' in (response.json as Record<string, unknown>)
        ? String((response.json as Record<string, unknown>).error)
        : `HTTP ${response.status ?? 'unknown'}`);
    throw new Error(message);
  }

  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy-legacy',
    durationMs: Date.now() - startedAt,
    status: response.status ?? 200,
  });

  if (response.status === 204) return undefined as T;
  if (response.json !== undefined) return response.json as T;
  return response.text as T;
}

function shouldFallbackToBrowser(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('invalid ipc channel: hostapi:fetch')
    || normalized.includes("no handler registered for 'hostapi:fetch'")
    || normalized.includes('no handler registered for "hostapi:fetch"')
    || normalized.includes('no handler registered for hostapi:fetch')
    || normalized.includes('window is not defined');
}

function allowLocalhostFallback(): boolean {
  try {
    return window.localStorage.getItem('clawx:allow-localhost-fallback') === '1';
  } catch {
    return false;
  }
}

export async function hostApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  console.log('hostApiFetch', path, init);
  const startedAt = Date.now();
  const method = init?.method || 'GET';
  // In Electron renderer, always proxy through main process to avoid CORS.
  try {
    const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
      path,
      method,
      headers: headersToRecord(init?.headers),
      body: init?.body ?? null,
    });

    if (typeof response?.ok === 'boolean' && 'data' in response) {
      return parseUnifiedProxyResponse<T>(response, path, method, startedAt);
    }

    return parseLegacyProxyResponse<T>(response, path, method, startedAt);
  } catch (error) {
    const normalized = normalizeAppError(error, { source: 'ipc-proxy', path, method });
    const message = normalized.message;
    trackUiEvent('hostapi.fetch_error', {
      path,
      method,
      source: 'ipc-proxy',
      durationMs: Date.now() - startedAt,
      message,
      code: normalized.code,
    });
    if (!shouldFallbackToBrowser(message)) {
      throw normalized;
    }
    if (!allowLocalhostFallback()) {
      trackUiEvent('hostapi.fetch_error', {
        path,
        method,
        source: 'ipc-proxy',
        durationMs: Date.now() - startedAt,
        message: 'localhost fallback blocked by policy',
        code: 'CHANNEL_UNAVAILABLE',
      });
      throw normalized;
    }
  }

  // Browser-only fallback (non-Electron environments).
  const token = await getHostApiToken();
  const response = await fetch(`${HOST_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'browser-fallback',
    durationMs: Date.now() - startedAt,
    status: response.status,
  });
  try {
    return await parseResponse<T>(response);
  } catch (error) {
    throw normalizeAppError(error, { source: 'browser-fallback', path, method });
  }
}

export function createHostEventSource(path = '/api/events'): EventSource {
  // EventSource does not support custom headers, so pass the auth token
  // as a query parameter. The server accepts both mechanisms.
  const separator = path.includes('?') ? '&' : '?';
  const tokenParam = `token=${encodeURIComponent(cachedHostApiToken ?? '')}`;
  return new EventSource(`${HOST_API_BASE}${path}${separator}${tokenParam}`);
}

export function getHostApiBase(): string {
  return HOST_API_BASE;
}

export type RuntimePluginToggleSnapshot = {
  success: boolean;
  aiExecAudit: { enabled: boolean };
  boomExecutorGuard: { enabled: boolean };
};

export type RuntimePluginId = 'ai-exec-audit' | 'boom-executor-guard';

export async function getRuntimePluginToggles(): Promise<RuntimePluginToggleSnapshot> {
  return await hostApiFetch<RuntimePluginToggleSnapshot>('/api/plugins/runtime-config');
}

export async function setRuntimePluginToggle(
  pluginId: RuntimePluginId,
  enabled: boolean,
): Promise<{ success: boolean; pluginId: RuntimePluginId; config: { enabled: boolean } }> {
  return await hostApiFetch<{ success: boolean; pluginId: RuntimePluginId; config: { enabled: boolean } }>(
    '/api/plugins/runtime-config',
    {
      method: 'POST',
      body: JSON.stringify({ pluginId, enabled }),
    },
  );
}
