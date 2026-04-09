import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';
import { getRecentTokenUsageHistory } from './token-usage';
import { getSetting } from './store';

export interface GatewayUsageReportPayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalCost?: number;
  raw?: unknown;
}

export type GatewayUsageReportReason = 'startup' | 'interval' | 'token-updated';

interface GatewayUsageLogEntry {
  timestamp: string;
  reason: GatewayUsageReportReason;
  source: string;
  ok: boolean;
  durationMs?: number;
  records?: number;
  sampleSize?: number;
  summary?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    totalCost?: number;
  };
  payload?: unknown;
  error?: string;
  errorDetail?: unknown;
}

type ModelUsageSnapshot = {
  model: string;
  totalTokens: number;
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
};

type ModelUsageConsumptionPayload = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
};

let usageLogFilePath: string | null = null;

function getUsageLogFilePath(): string {
  if (usageLogFilePath) return usageLogFilePath;
  const logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  usageLogFilePath = join(logDir, 'gateway-usage.jsonl');
  return usageLogFilePath;
}

function safeJsonStringify(input: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(input, (_key, value) => {
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

function writeGatewayUsageLog(entry: GatewayUsageLogEntry): void {
  try {
    appendFileSync(getUsageLogFilePath(), `${safeJsonStringify(entry)}\n`);
  } catch {
    // Best-effort only.
  }
}

function serializeErrorDetail(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const base = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  } as Record<string, unknown>;
  const withNodeFields = error as Error & {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    address?: unknown;
    port?: unknown;
    cause?: unknown;
  };
  if (withNodeFields.code !== undefined) base.code = withNodeFields.code;
  if (withNodeFields.errno !== undefined) base.errno = withNodeFields.errno;
  if (withNodeFields.syscall !== undefined) base.syscall = withNodeFields.syscall;
  if (withNodeFields.address !== undefined) base.address = withNodeFields.address;
  if (withNodeFields.port !== undefined) base.port = withNodeFields.port;
  if (withNodeFields.cause !== undefined) {
    base.cause = serializeErrorDetail(withNodeFields.cause);
  }
  return base;
}

function buildSummary(entries: Awaited<ReturnType<typeof getRecentTokenUsageHistory>>) {
  return entries.reduce<NonNullable<GatewayUsageLogEntry['summary']>>(
    (acc, entry) => {
      acc.inputTokens = (acc.inputTokens ?? 0) + (entry.inputTokens || 0);
      acc.outputTokens = (acc.outputTokens ?? 0) + (entry.outputTokens || 0);
      acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + (entry.cacheReadTokens || 0);
      acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + (entry.cacheWriteTokens || 0);
      acc.totalTokens = (acc.totalTokens ?? 0) + (entry.totalTokens || 0);
      acc.totalCost = (acc.totalCost ?? 0) + (entry.costUsd || 0);
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  );
}

function isSameLocalDay(timestamp: string, now = new Date()): boolean {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  );
}

function buildModelUsage(entries: Awaited<ReturnType<typeof getRecentTokenUsageHistory>>): ModelUsageSnapshot[] {
  const grouped = new Map<string, ModelUsageSnapshot>();
  for (const entry of entries) {
    const model = entry.label || entry.model || 'Unknown';
    const current = grouped.get(model) ?? {
      model,
      totalTokens: 0,
      inputTokens: 0,
      cacheTokens: 0,
      outputTokens: 0,
    };
    current.totalTokens += entry.totalTokens || 0;
    current.inputTokens += entry.inputTokens || 0;
    current.cacheTokens += (entry.cacheReadTokens || 0) + (entry.cacheWriteTokens || 0);
    current.outputTokens += entry.outputTokens || 0;
    grouped.set(model, current);
  }

  return [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function resolveBusinessBaseUrl(): string {
  const raw = (
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || ''
  ).trim();
  return raw.replace(/\/+$/, '');
}

async function collectRecentUsage(limit?: number): Promise<{
  todayEntries: Awaited<ReturnType<typeof getRecentTokenUsageHistory>>;
  modelUsage: ModelUsageSnapshot[];
  summary: NonNullable<GatewayUsageLogEntry['summary']>;
}> {
  const entries = await getRecentTokenUsageHistory(limit);
  const todayEntries = entries.filter((entry) => isSameLocalDay(entry.timestamp));
  const modelUsage = buildModelUsage(todayEntries);
  return {
    todayEntries,
    modelUsage,
    summary: buildSummary(todayEntries),
  };
}

function toConsumptionPayload(models: ModelUsageSnapshot[]): ModelUsageConsumptionPayload[] {
  return models.map((item) => ({
    model: item.model,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    cache_tokens: item.cacheTokens,
  }));
}

async function writeDevUsageLog(
  reason: GatewayUsageReportReason,
  usage: {
    todayEntries: Awaited<ReturnType<typeof getRecentTokenUsageHistory>>;
    modelUsage: ModelUsageSnapshot[];
    summary: NonNullable<GatewayUsageLogEntry['summary']>;
  },
  durationMs: number,
): Promise<void> {
  const source = 'recent-token-history';
  try {
    writeGatewayUsageLog({
      timestamp: new Date().toISOString(),
      reason,
      source,
      ok: true,
      durationMs,
      records: usage.modelUsage.length,
      sampleSize: usage.todayEntries.length,
      summary: usage.summary,
      payload: usage.modelUsage,
    });
  } catch (error) {
    writeGatewayUsageLog({
      timestamp: new Date().toISOString(),
      reason,
      source,
      ok: false,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      errorDetail: serializeErrorDetail(error),
    });
  }
}
 
/**
 * Unified gateway usage reporter entrypoint.
 * - Dev: write local usage snapshot logs for validation.
 * - Prod: remote reporting is intentionally disabled for now.
 */
export async function reportGatewayUsage(
  reason: GatewayUsageReportReason,
  _payload?: GatewayUsageReportPayload,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const usage = await collectRecentUsage();

    if (!app.isPackaged) {
      await writeDevUsageLog(reason, usage, Date.now() - startedAt);
    }

    const configuredBaseUrl = (await getSetting('businessApiBaseUrl')).trim();
    const baseUrl = (configuredBaseUrl || resolveBusinessBaseUrl()).replace(/\/+$/, '');
    if (!baseUrl) {
      logger.warn('[gateway-usage-report] skipped: business base URL is empty');
      return;
    }

    const token = (await getSetting('businessAuthToken')).trim();
    if (!token) {
      logger.warn('[gateway-usage-report] skipped: business auth token missing');
      return;
    }

    const response = await fetch(`${baseUrl}/custom-point-consumptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(toConsumptionPayload(usage.modelUsage)),
    });

    if (!response.ok) {
      logger.warn(
        `[gateway-usage-report] non-2xx response: status=${response.status} reason=${reason}`,
      );
      return;
    }

    logger.info(
      `[gateway-usage-report] reported successfully: models=${usage.modelUsage.length} reason=${reason}`,
    );
  } catch (error) {
    logger.warn('[gateway-usage-report] request failed:', error);
  }
}
