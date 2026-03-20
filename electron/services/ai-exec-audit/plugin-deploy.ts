import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir, getResourcesDir } from '../../utils/paths';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import * as logger from '../../utils/logger';

const PLUGIN_ID = 'ai-exec-audit';
const PLUGIN_SOURCE_DIR = 'ai-exec-audit-plugin';
const PLUGIN_FILES = ['index.js', 'openclaw.plugin.json', 'package.json'];

function getPluginDestDir(): string {
  return join(getOpenClawConfigDir(), 'extensions', PLUGIN_ID);
}

function getPluginSourceDir(): string {
  return join(getResourcesDir(), PLUGIN_SOURCE_DIR);
}

async function deployPluginFiles(): Promise<void> {
  const srcDir = getPluginSourceDir();
  const destDir = getPluginDestDir();

  if (!existsSync(srcDir)) {
    throw new Error(`AI exec audit plugin source not found: ${srcDir}`);
  }

  await mkdir(destDir, { recursive: true });
  for (const file of PLUGIN_FILES) {
    await copyFile(join(srcDir, file), join(destDir, file));
  }
}

async function setPluginConfig(enabled: boolean): Promise<void> {
  const config = await readOpenClawConfig();
  const plugins = (config.plugins && typeof config.plugins === 'object'
    ? { ...(config.plugins as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const entries = (plugins.entries && typeof plugins.entries === 'object'
    ? { ...(plugins.entries as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  const previous = (entries[PLUGIN_ID] && typeof entries[PLUGIN_ID] === 'object'
    ? { ...(entries[PLUGIN_ID] as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  entries[PLUGIN_ID] = {
    ...previous,
    enabled,
    config: {
      enabled: true,
      failureMode: 'fail-open',
      failureThreshold: 3,
      cooldownSeconds: 120,
      cacheTtlSeconds: 300,
      auditLog: true,
      auditReportUrl: '',
    },
  };

  plugins.entries = entries;

  const allow = Array.isArray(plugins.allow) ? [...(plugins.allow as string[])] : [];
  if (enabled) {
    if (allow.length > 0 && !allow.includes(PLUGIN_ID)) {
      plugins.allow = [...allow, PLUGIN_ID];
    }
  } else {
    if (allow.includes(PLUGIN_ID)) {
      plugins.allow = allow.filter((id) => id !== PLUGIN_ID);
    }
  }

  config.plugins = plugins;
  await writeOpenClawConfig(config);
}

export async function ensureAiExecAuditPlugin(): Promise<void> {
  try {
    await deployPluginFiles();
    await setPluginConfig(true);
    logger.info('[ai-exec-audit] Plugin ready');
  } catch (error) {
    logger.warn('[ai-exec-audit] Failed to deploy plugin', String(error));
  }
}

export async function setAiExecAuditEnabled(enabled: boolean): Promise<void> {
  await setPluginConfig(enabled);
}
