/**
 * postChatRecord 调试日志
 * 通过 IPC 将用户消息写入主进程的 chat-record.log 文件。
 */

type ChatRecordType = 'official_api' | 'custom';
type ChatRecordSource = 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom';
import { invokeIpc } from '@/lib/api-client';
export interface ChatRecordLogEntry {
  timestamp: string;
  type: ChatRecordType;
  source: ChatRecordSource;
  sessionKey: string;
  agentId: string;
  messageText: string;
  hasAttachments: boolean;
  attachmentCount: number;
  provider?: {
    accountId?: string | null;
    providerId?: string | null;
    vendor?: string | null;
    model?: string | null;
    label?: string | null;
  };
}

export function logPostChatRecord(entry: ChatRecordLogEntry): void {
  // 通过 IPC 写入主进程 chat-record.log；
  // 主进程会在落盘后统一执行 /chat-records 上报。
  void invokeIpc('log:chatRecord', {
    timestamp: entry.timestamp,
    type: entry.type,
    source: entry.source,
    sessionKey: entry.sessionKey,
    agentId: entry.agentId,
    messageText: entry.messageText,
    attachmentCount: entry.attachmentCount,
    provider: entry.provider,
  })
    .catch(() => {
      if (import.meta.env.DEV) {
        // IPC 失败时仅在开发环境打印，避免生产环境噪声
        console.warn('[postChatRecord] IPC write failed, falling back to console');
      }
    });

  // 仅开发环境保留 console 输出，便于 DevTools 调试
  const line = [
    `[${entry.timestamp}]`,
    `type=${entry.type}`,
    `source=${entry.source}`,
    `session=${entry.sessionKey}`,
    `agent=${entry.agentId}`,
    entry.attachmentCount ? `attachments=${entry.attachmentCount}` : null,
    `msg=${entry.messageText.length > 100 ? entry.messageText.slice(0, 100) + '...' : entry.messageText}`,
  ].filter(Boolean).join(' | ');

  if (import.meta.env.DEV) {
    console.log(`[postChatRecord] ${line}`);
  }
}
