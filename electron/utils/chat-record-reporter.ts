import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';
import { getSetting } from './store';

export type ChatRecordType = 'official_api' | 'custom';
export type ChatRecordSource = 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom';

export interface ChatRecordProviderInfo {
  accountId?: string | null;
  providerId?: string | null;
  vendor?: string | null;
  model?: string | null;
  label?: string | null;
}

export interface ChatRecordEntry {
  timestamp: string;
  type?: ChatRecordType;
  source: string;
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  messageText: string;
  attachmentCount?: number;
  extra?: string;
  provider?: ChatRecordProviderInfo;
}

const SOURCE_ALIAS_MAP: Record<string, ChatRecordSource> = {
  platform: 'platform',
  web: 'platform',
  desktop: 'platform',
  app: 'platform',
  internal: 'platform',
  gateway: 'platform',
  'openclaw-gateway': 'platform',
  wechat: 'wechat',
  weixin: 'wechat',
  'openclaw-weixin': 'wechat',
  'tencent-weixin': 'wechat',
  'wx-bot': 'wechat',
  wx: 'wechat',
  qq: 'qq',
  qqbot: 'qq',
  'qq-bot': 'qq',
  'openclaw-qqbot': 'qq',
  qbot: 'qq',
  feishu: 'feishu',
  lark: 'feishu',
  'openclaw-feishu': 'feishu',
  wecom: 'wecom',
  wxwork: 'wecom',
  'openclaw-wecom': 'wecom',
  qiyeweixin: 'wecom',
};

let logFilePath: string | null = null;
let rawLogFilePath: string | null = null;
const rawLogSessionId = new Date().toISOString().replace(/[:.]/g, '-');

function isDev(): boolean {
  return !app.isPackaged;
}

function resolveBusinessBaseUrl(): string {
  const raw = (
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || ''
  ).trim();
  return raw.replace(/\/+$/, '');
}

function getLogFilePath(): string {
  if (logFilePath) return logFilePath;
  const logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  logFilePath = join(logDir, 'chat-record.jsonl');
  return logFilePath;
}

function getRawLogFilePath(): string {
  if (rawLogFilePath) return rawLogFilePath;
  const logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  rawLogFilePath = join(logDir, `chat-record-raw-${rawLogSessionId}.jsonl`);
  return rawLogFilePath;
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

export function normalizeChatRecordSource(raw: unknown): ChatRecordSource | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return SOURCE_ALIAS_MAP[key] ?? null;
}

export function resolveChatRecordTypeBySource(source: ChatRecordSource): ChatRecordType {
  return source === 'platform' ? 'official_api' : 'custom';
}

function resolveChatRecordType(entry: ChatRecordEntry, source: ChatRecordSource): ChatRecordType {
  const providerId = entry.provider?.providerId?.trim().toLowerCase();
  if (providerId) {
    return providerId === 'baowenmao' ? 'official_api' : 'custom';
  }
  if (entry.type) {
    return entry.type;
  }
  return resolveChatRecordTypeBySource(source);
}

/**
 * Report chat record to business backend.
 * Best-effort only: never throws to caller.
 */
export async function reportChatRecord(type: ChatRecordType, source: ChatRecordSource): Promise<void> {
  const configuredBaseUrl = (await getSetting('businessApiBaseUrl')).trim();
  const baseUrl = (configuredBaseUrl || resolveBusinessBaseUrl()).replace(/\/+$/, '');
  if (!baseUrl) return;

  try {
    const token = (await getSetting('businessAuthToken')).trim();
    if (!token) {
      logger.warn('[chat-record-report] skipped: business auth token missing');
      return;
    }

    const response = await fetch(`${baseUrl}/chat-records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type, source }),
    });
    if (!response.ok) {
      logger.warn(
        `[chat-record-report] non-2xx response: status=${response.status} source=${source} type=${type}`,
      );
    }
  } catch (error) {
    logger.warn('[chat-record-report] request failed:', error);
  }
}

export function writeChatRecord(entry: ChatRecordEntry): void {
  const normalizedSource = normalizeChatRecordSource(entry.source);
  const source = normalizedSource ?? 'platform';
  const type = resolveChatRecordType(entry, source);
  const payload = {
    timestamp: entry.timestamp,
    type,
    source,
    rawSource: normalizedSource ? undefined : entry.source,
    sessionKey: entry.sessionKey,
    agentId: entry.agentId,
    runId: entry.runId,
    attachmentCount: entry.attachmentCount,
    extra: entry.extra,
    provider: entry.provider ?? null,
    messageText: entry.messageText,
  };

  if (isDev()) {
    try {
      appendFileSync(getLogFilePath(), `${safeJsonStringify(payload)}\n`);
    } catch {
      // Best-effort local logging.
    }
  }

  void reportChatRecord(type, source);
}

export function writeGatewayRawMessage(message: unknown): void {
  if (!isDev()) return;
  const timestamp = new Date().toISOString();
  let payload: string;
  try {
    payload = safeJsonStringify(message);
  } catch {
    payload = String(message);
  }
  const MAX_LEN = 16_000;
  const truncated = payload.length > MAX_LEN ? `${payload.slice(0, MAX_LEN)}...<truncated>` : payload;
  const line = safeJsonStringify({ timestamp, raw: truncated });
  try {
    appendFileSync(getRawLogFilePath(), `${line}\n`);
  } catch {
    // Best-effort local logging.
  }
}

