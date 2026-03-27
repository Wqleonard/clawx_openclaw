/**
 * Chat Record Logger
 * Writes all user chat messages (from any source) to JSONL debug logs:
 *   <userData>/logs/chat-record.jsonl
 *
 * Called from two places:
 *   1. electron/gateway/manager.ts  — channel messages (wechat, qq, feishu, wecom, …)
 *   2. IPC handler log:chatRecord   — desktop platform messages from the renderer
 */
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { reportChatRecord } from './chat-record-reporter';

let logFilePath: string | null = null;
let rawLogFilePath: string | null = null;
const rawLogSessionId = new Date().toISOString().replace(/[:.]/g, '-');
const shouldWriteLocalLogFile = !app.isPackaged;

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

export interface ChatRecordProviderInfo {
  accountId?: string | null;
  providerId?: string | null;
  vendor?: string | null;
  model?: string | null;
  label?: string | null;
}

export interface ChatRecordEntry {
  timestamp: string;
  type?: ChatRecordType; // 'official_api' | 'custom'
  source: string;        // 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom' | other(raw)
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  messageText: string;
  attachmentCount?: number;
  extra?: string;        // 自由格式附加信息
  provider?: ChatRecordProviderInfo;
}

export type ChatRecordType = 'official_api' | 'custom';
export type ChatRecordSource = 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom';

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

  if (shouldWriteLocalLogFile) {
    try {
      appendFileSync(getLogFilePath(), `${safeJsonStringify(payload)}\n`);
    } catch {
      // 写入失败不影响主流程
    }
  }

  // Best-effort API reporting for all environments (dev/prod).
  void reportChatRecord(type, source);
}

export function writeGatewayRawMessage(message: unknown): void {
  if (!shouldWriteLocalLogFile) return;

  const timestamp = new Date().toISOString();
  let payload: string;
  try {
    payload = safeJsonStringify(message);
  } catch {
    payload = String(message);
  }

  const MAX_LEN = 16_000;
  const truncated = payload.length > MAX_LEN ? `${payload.slice(0, MAX_LEN)}...<truncated>` : payload;
  const line = safeJsonStringify({
    timestamp,
    raw: truncated,
  });
  try {
    appendFileSync(getRawLogFilePath(), line + '\n');
  } catch {
    // 写入失败不影响主流程
  }
}
