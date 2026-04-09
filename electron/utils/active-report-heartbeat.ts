import { getSetting } from './store';
import { logger } from './logger';
import {
  reportGatewayUsage,
  type GatewayUsageReportReason,
} from './gateway-usage-reporter';

const ACTIVE_REPORT_INTERVAL_MS = 30 * 60 * 1000;

let heartbeatTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let missingBaseUrlLogged = false;
let missingTokenLogged = false;
let isGatewayRunningResolver: (() => boolean) | null = null;

async function captureGatewayUsageForDev(reason: GatewayUsageReportReason): Promise<void> {
  if (!isGatewayRunningResolver || !isGatewayRunningResolver()) return;
  await reportGatewayUsage(reason);
}

function resolveBusinessBaseUrl(): string {
  const raw = (
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || ''
  ).trim();
  return raw.replace(/\/+$/, '');
}

async function reportActive(reason: 'startup' | 'interval' | 'token-updated'): Promise<void> {
  if (inFlight) return;
  // Dev-phase validation only: capture local recent-token-history snapshot into jsonl.
  try {
    const configuredBaseUrl = (await getSetting('businessApiBaseUrl')).trim();
    await captureGatewayUsageForDev(reason);

    const baseUrl = (configuredBaseUrl || resolveBusinessBaseUrl()).replace(/\/+$/, '');
    if (!baseUrl) {
      if (!missingBaseUrlLogged) {
        missingBaseUrlLogged = true;
        logger.warn('[active-report-heartbeat] skipped: business base URL is empty');
      }
      return;
    }
    if (missingBaseUrlLogged) {
      missingBaseUrlLogged = false;
      logger.info('[active-report-heartbeat] business base URL restored');
    }

    const token = (await getSetting('businessAuthToken')).trim();
    if (!token) {
      if (!missingTokenLogged) {
        missingTokenLogged = true;
        logger.warn(`[active-report-heartbeat] skipped: business auth token missing (reason=${reason})`);
      }
      return;
    }
    if (missingTokenLogged) {
      missingTokenLogged = false;
      logger.info('[active-report-heartbeat] business auth token restored');
    }

    inFlight = true;
    const response = await fetch(`${baseUrl}/active/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.ok) {
      logger.info(
        `[active-report-heartbeat] report sent successfully: status=${response.status} reason=${reason}`,
      );
    }

    if (!response.ok) {
      logger.warn(
        `[active-report-heartbeat] non-2xx response: status=${response.status} reason=${reason}`,
      );
    }
  } catch (error) {
    logger.warn('[active-report-heartbeat] request failed:', error);
  } finally {
    inFlight = false;
  }
}

export function startActiveReportHeartbeat(): void {
  if (heartbeatTimer) return;

  logger.info('[active-report-heartbeat] started');
  void reportActive('startup');
  heartbeatTimer = setInterval(() => {
    void reportActive('interval');
  }, ACTIVE_REPORT_INTERVAL_MS);
}

export function setGatewayRunningResolver(resolver: (() => boolean) | null): void {
  isGatewayRunningResolver = resolver;
}

export function triggerActiveReportHeartbeatNow(): void {
  void reportActive('token-updated');
}

export function stopActiveReportHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  logger.info('[active-report-heartbeat] stopped');
}

