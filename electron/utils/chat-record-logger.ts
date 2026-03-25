/**
 * Chat Record Logger
 * Writes all user chat messages (from any source) to a single debug log file:
 *   <userData>/logs/chat-record.log
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

function getLogFilePath(): string {
  if (logFilePath) return logFilePath;
  const logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  logFilePath = join(logDir, 'chat-record.log');
  return logFilePath;
}

function getRawLogFilePath(): string {
  if (rawLogFilePath) return rawLogFilePath;
  const logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  // Per-process raw log file to keep only current app-start data
  // and avoid unbounded growth from historical app sessions.
  rawLogFilePath = join(logDir, `chat-record-raw-${rawLogSessionId}.log`);
  return rawLogFilePath;
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
  const type = entry.type ?? resolveChatRecordTypeBySource(source);
  const line = [
    `[${entry.timestamp}]`,
    `type=${type}`,
    `source=${source}`,
    entry.sessionKey ? `session=${entry.sessionKey}` : null,
    entry.agentId    ? `agent=${entry.agentId}`       : null,
    entry.runId      ? `runId=${entry.runId}`          : null,
    entry.attachmentCount ? `attachments=${entry.attachmentCount}` : null,
    normalizedSource ? null : `rawSource=${entry.source}`,
    entry.extra      ? `extra=${entry.extra}`          : null,
    `msg=${entry.messageText.length > 200 ? entry.messageText.slice(0, 200) + '…' : entry.messageText}`,
  ].filter(Boolean).join(' | ');

  try {
    appendFileSync(getLogFilePath(), line + '\n');
  } catch {
    // 写入失败不影响主流程
  }

  // Best-effort API reporting for all environments (dev/prod).
  void reportChatRecord(type, source);
}

export function writeGatewayRawMessage(message: unknown): void {
  const timestamp = new Date().toISOString();
  let payload: string;
  try {
    payload = safeJsonStringify(message);
  } catch {
    payload = String(message);
  }

  const MAX_LEN = 16_000;
  const truncated = payload.length > MAX_LEN ? `${payload.slice(0, MAX_LEN)}...<truncated>` : payload;
  const line = `[${timestamp}] | raw=${truncated}`;
  try {
    appendFileSync(getRawLogFilePath(), line + '\n');
  } catch {
    // 写入失败不影响主流程
  }
}
