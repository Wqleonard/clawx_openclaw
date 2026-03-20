import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import { listConfiguredAgentIds } from './agent-config';
import { listProviderAccounts } from '../services/providers/provider-store';

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

const USAGE_LABEL_OVERRIDES = new Map<string, string>([
  ['glm:custom-baowenmao', 'GLM-5'],
  ['aliyun:glm-5', 'GLM-5'],
  ['glm-5', 'GLM-5'],
]);

async function listAgentIdsWithSessionDirs(): Promise<string[]> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');
  const agentIds = new Set<string>();

  try {
    for (const agentId of await listConfiguredAgentIds()) {
      const normalized = agentId.trim();
      if (normalized) {
        agentIds.add(normalized);
      }
    }
  } catch {
    // Ignore config discovery failures and fall back to disk scan.
  }

  try {
    const agentEntries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isDirectory()) {
        const normalized = entry.name.trim();
        if (normalized) {
          agentIds.add(normalized);
        }
      }
    }
  } catch {
    // Ignore disk discovery failures and return whatever we already found.
  }

  return [...agentIds];
}

async function listRecentSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');

  try {
    const agentEntries = await listAgentIdsWithSessionDirs();
    const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

    for (const agentId of agentEntries) {
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      try {
        const sessionEntries = await readdir(sessionsDir);

        for (const fileName of sessionEntries) {
          const sessionId = extractSessionIdFromTranscriptFileName(fileName);
          if (!sessionId) continue;
          const filePath = join(sessionsDir, fileName);
          try {
            const fileStat = await stat(filePath);
            files.push({
              filePath,
              sessionId,
              agentId,
              mtimeMs: fileStat.mtimeMs,
            });
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
  } catch {
    return [];
  }
}

function getLookupCandidates(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>([trimmed.toLowerCase()]);
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
    candidates.add(trimmed.slice(colonIndex + 1).trim().toLowerCase());
  }

  return [...candidates];
}

function resolveCanonicalUsageLabel(
  rawLabel: string | undefined,
  entry: Pick<TokenUsageHistoryEntry, 'model' | 'provider'>,
): string | undefined {
  for (const candidate of [...getLookupCandidates(entry.model), ...getLookupCandidates(entry.provider)]) {
    const override = USAGE_LABEL_OVERRIDES.get(candidate);
    if (override) return override;
  }

  if (!rawLabel) return undefined;
  const trimmed = rawLabel.trim();
  if (!trimmed) return undefined;

  const directOverride = USAGE_LABEL_OVERRIDES.get(trimmed.toLowerCase());
  return directOverride ?? trimmed;
}

async function buildUsageLabelLookup(): Promise<Map<string, string>> {
  if (!process.versions.electron) {
    return new Map<string, string>();
  }
  const accounts = await listProviderAccounts();
  const lookup = new Map<string, string>();

  for (const account of accounts) {
    const label = account.label?.trim();
    if (!label) continue;

    for (const key of getLookupCandidates(account.id)) {
      if (!lookup.has(key)) lookup.set(key, label);
    }
    for (const key of getLookupCandidates(account.model)) {
      if (!lookup.has(key)) lookup.set(key, label);
    }
  }

  return lookup;
}

function withResolvedUsageLabel(
  entry: TokenUsageHistoryEntry,
  lookup: Map<string, string>,
): TokenUsageHistoryEntry {
  const existingLabel = resolveCanonicalUsageLabel(entry.label, entry);
  if (existingLabel) {
    if (existingLabel === entry.label) return entry;
    return { ...entry, label: existingLabel };
  }

  for (const candidate of [...getLookupCandidates(entry.model), ...getLookupCandidates(entry.provider)]) {
    const label = lookup.get(candidate);
    if (label) {
      return { ...entry, label: resolveCanonicalUsageLabel(label, entry) ?? label };
    }
  }

  const fallbackLabel = resolveCanonicalUsageLabel(undefined, entry);
  if (fallbackLabel) {
    return { ...entry, label: fallbackLabel };
  }

  return entry;
}

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const files = await listRecentSessionFiles();
  const results: TokenUsageHistoryEntry[] = [];
  let labelLookup = new Map<string, string>();
  try {
    labelLookup = await buildUsageLabelLookup();
  } catch (error) {
    logger.debug('Failed to build usage label lookup:', error);
  }
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const file of files) {
    if (results.length >= maxEntries) break;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }, Number.isFinite(maxEntries) ? maxEntries - results.length : undefined);
      results.push(...entries.map((entry) => withResolvedUsageLabel(entry, labelLookup)));
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
