import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { logger } from './logger';

type CrashReportEnvelope = {
  crashId: string;
  event_id: string;
  event_name: 'app_crash';
  event_time: string;
  payload: Record<string, unknown>;
  logFilePath: string | null;
};

const DEFAULT_REPORT_PATH = '/data-analysis-records';
const REPORT_TIMEOUT_MS = 4500;

function sanitizeText(input: unknown): string {
  return String(input ?? '')
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveBusinessBaseUrl(): string {
  const raw = String(
    process.env.BUSINESS_API_BASE_URL
      || process.env.VITE_BUSINESS_API_BASE_URL
      || ''
  ).trim();
  return raw.replace(/\/+$/, '');
}

function buildReportUrl(): string {
  const baseUrl = resolveBusinessBaseUrl();
  if (!baseUrl) return '';
  return new URL(DEFAULT_REPORT_PATH, `${baseUrl}/`).toString();
}

function getTelemetryDir(): string {
  return join(app.getPath('userData'), 'telemetry');
}

function ensureTelemetryDir(): string {
  const dir = getTelemetryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getPendingFilePath(): string {
  return join(ensureTelemetryDir(), 'pending-app-crash-reports.json');
}

function getReportedIdsFilePath(): string {
  return join(ensureTelemetryDir(), 'reported-app-crash-ids.json');
}

function getReportedLogIndexFilePath(): string {
  return join(ensureTelemetryDir(), 'reported-crash-logs.json');
}

function getAnonymousDeviceIdFilePath(): string {
  return join(ensureTelemetryDir(), 'anonymous-device-id.txt');
}

function readJsonFileSafe<T>(filePath: string, fallback: T): T {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFileSafe(filePath: string, value: unknown): void {
  try {
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch (error) {
    logger.warn('[crash-report] failed to write json file:', { filePath, error });
  }
}

function readRegistryValue(key: string, valueName: string): string {
  if (process.platform !== 'win32') return '';
  try {
    const output = execFileSync('reg.exe', ['QUERY', key, '/v', valueName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
      windowsHide: true,
    });
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!line.toLowerCase().startsWith(valueName.toLowerCase())) continue;
      const parts = line.split(/\s{2,}/).filter(Boolean);
      if (parts.length >= 3) {
        return sanitizeText(parts.slice(2).join(' '));
      }
    }
  } catch {
    // Best effort only.
  }
  return '';
}

function resolveMachineInfo(): Record<string, unknown> {
  const manufacturer = readRegistryValue(
    'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS',
    'SystemManufacturer'
  );
  const model = readRegistryValue('HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS', 'SystemProductName');
  const cpuModel = sanitizeText(os.cpus()?.[0]?.model || '');
  return {
    manufacturer: manufacturer || undefined,
    model: model || undefined,
    cpuModel: cpuModel || undefined,
    cpuCount: Array.isArray(os.cpus()) ? os.cpus().length : undefined,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
  };
}

function getOrCreateAnonymousDeviceId(): string {
  const path = getAnonymousDeviceIdFilePath();
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // Ignore and create below.
  }

  const created = crypto.randomUUID();
  try {
    writeFileSync(path, `${created}\n`, 'utf8');
  } catch (error) {
    logger.warn('[crash-report] failed to persist anonymous device id:', error);
  }
  return created;
}

function buildCrashPayload(input: {
  reason: string;
  error: unknown;
  logFilePath: string | null;
}): Record<string, unknown> {
  const errorMessage = input.error instanceof Error
    ? `${input.error.name}: ${input.error.message}`
    : sanitizeText(input.error);
  const stack = input.error instanceof Error ? input.error.stack : undefined;
  const appSlug = sanitizeText(app.getName() || 'storyclaw') || 'storyclaw';
  const crashId = crypto.randomUUID();

  return {
    event: 'app_crash',
    // Keep the same identifier shape as install reporters.
    installId: crashId,
    crashId,
    anonymousDeviceId: getOrCreateAnonymousDeviceId(),
    app: {
      id: 'app.storyclaw.desktop',
      slug: appSlug,
      productName: sanitizeText(app.getName() || 'StoryClaw') || 'StoryClaw',
      version: app.getVersion(),
      channel: app.isPackaged ? 'stable' : 'dev',
      source: 'desktop_crash',
    },
    // Keep payload layout aligned with install reporters: app + installation + system.
    installation: {
      reason: sanitizeText(input.reason) || 'unknown',
      error: errorMessage,
      stack: stack ? sanitizeText(stack).slice(0, 4000) : undefined,
      crashedAt: new Date().toISOString(),
      processType: 'main',
      pid: process.pid,
      logFilePath: input.logFilePath || undefined,
    },
    system: {
      platform: process.platform,
      arch: os.arch(),
      release: os.release(),
      version: typeof os.version === 'function' ? sanitizeText(os.version()) : undefined,
      ...resolveMachineInfo(),
    },
  };
}

function generateEventId(): string {
  return `evt_${crypto.randomBytes(5).toString('hex')}`;
}

function buildCrashEnvelope(input: {
  reason: string;
  error: unknown;
  logFilePath: string | null;
}): CrashReportEnvelope {
  const payload = buildCrashPayload(input);
  const payloadRecord = payload as { installId?: string; crashId?: string };
  return {
    crashId: String(payloadRecord.installId || payloadRecord.crashId || crypto.randomUUID()),
    event_id: generateEventId(),
    event_name: 'app_crash',
    event_time: new Date().toISOString(),
    payload,
    logFilePath: input.logFilePath,
  };
}

function loadPending(): CrashReportEnvelope[] {
  return readJsonFileSafe<CrashReportEnvelope[]>(getPendingFilePath(), []);
}

function savePending(next: CrashReportEnvelope[]): void {
  writeJsonFileSafe(getPendingFilePath(), next);
}

function loadReportedIds(): Set<string> {
  const ids = readJsonFileSafe<string[]>(getReportedIdsFilePath(), []);
  return new Set(ids.filter(Boolean));
}

function saveReportedIds(ids: Set<string>): void {
  writeJsonFileSafe(getReportedIdsFilePath(), [...ids]);
}

function markCrashLogReported(envelope: CrashReportEnvelope): void {
  const index = readJsonFileSafe<Array<{
    crashId: string;
    reportedAt: string;
    logFilePath: string | null;
    eventTime: string;
  }>>(getReportedLogIndexFilePath(), []);
  if (index.some((item) => item.crashId === envelope.crashId)) return;
  index.push({
    crashId: envelope.crashId,
    reportedAt: new Date().toISOString(),
    logFilePath: envelope.logFilePath,
    eventTime: envelope.event_time,
  });
  writeJsonFileSafe(getReportedLogIndexFilePath(), index);
}

export function queueCrashReport(input: {
  reason: string;
  error: unknown;
  logFilePath: string | null;
}): { crashId: string } {
  const envelope = buildCrashEnvelope(input);
  const pending = loadPending();
  pending.push(envelope);
  savePending(pending);
  return { crashId: envelope.crashId };
}

async function sendCrashEnvelope(reportUrl: string, envelope: CrashReportEnvelope): Promise<void> {
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REPORT_TIMEOUT_MS)
    : undefined;
  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `StoryClaw/${app.getVersion() || 'unknown'}`,
    },
    body: JSON.stringify({
      event_id: envelope.event_id,
      event_name: envelope.event_name,
      event_time: envelope.event_time,
      payload: envelope.payload,
    }),
    signal: timeoutSignal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function flushPendingCrashReports(options?: { limit?: number }): Promise<void> {
  const reportUrl = buildReportUrl();
  if (!reportUrl) {
    logger.warn('[crash-report] skipped: business base URL is empty');
    return;
  }

  const pending = loadPending();
  if (pending.length === 0) return;

  const reportedIds = loadReportedIds();
  const remaining: CrashReportEnvelope[] = [];
  const limit = options?.limit && options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
  let sentCount = 0;

  for (const envelope of pending) {
    if (reportedIds.has(envelope.crashId)) {
      continue;
    }
    if (sentCount >= limit) {
      remaining.push(envelope);
      continue;
    }

    try {
      await sendCrashEnvelope(reportUrl, envelope);
      sentCount += 1;
      reportedIds.add(envelope.crashId);
      markCrashLogReported(envelope);
    } catch (error) {
      remaining.push(envelope);
      logger.warn('[crash-report] send failed, will retry on next launch:', {
        crashId: envelope.crashId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  savePending(remaining);
  saveReportedIds(reportedIds);
}

