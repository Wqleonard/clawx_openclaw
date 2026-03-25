import { logger } from './logger';
import { getSetting } from './store';

export type ChatRecordType = 'official_api' | 'custom';
export type ChatRecordSource = 'platform' | 'wechat' | 'qq' | 'feishu' | 'wecom';

function resolveBusinessBaseUrl(): string {
  const raw = (
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || ''
  ).trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Report chat record to business backend.
 * Best-effort only: never throws to caller.
 */
export async function reportChatRecord(type: ChatRecordType, source: ChatRecordSource): Promise<void> {
  const baseUrl = resolveBusinessBaseUrl();
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

