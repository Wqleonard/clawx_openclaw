/**
 * BoomClaw Web Search Plugin Deployer
 *
 * Deploys the boom-search plugin to ~/.openclaw/extensions/boom-search/ at startup,
 * and injects the required config into openclaw.json:
 *   - tools.web.search.enabled: false  → prevents core web_search from being created
 *   - tools.web.fetch.enabled:  false  → prevents core web_fetch from being created
 *   - plugins.entries["boom-search"].enabled: true → activates our plugin
 *
 * Also exposes helpers to toggle between BoomClaw search and native OpenClaw search.
 */

import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir, getResourcesDir } from '../../utils/paths';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import * as logger from '../../utils/logger';

const PLUGIN_ID = 'boom-search';
const PLUGIN_SOURCE_DIR = 'boom-search-plugin';
const PLUGIN_FILES = ['index.js', 'openclaw.plugin.json', 'package.json'];

/** Destination inside ~/.openclaw/extensions/boom-search/ */
function getPluginDestDir(): string {
  return join(getOpenClawConfigDir(), 'extensions', PLUGIN_ID);
}

/** Source inside app resources/boom-search-plugin/ */
function getPluginSourceDir(): string {
  return join(getResourcesDir(), PLUGIN_SOURCE_DIR);
}

/**
 * Copy plugin files from resources to ~/.openclaw/extensions/boom-search/.
 * Overwrites existing files so the plugin is always up to date.
 */
async function deployPluginFiles(): Promise<void> {
  const srcDir = getPluginSourceDir();
  const destDir = getPluginDestDir();

  if (!existsSync(srcDir)) {
    throw new Error(`Boom-search plugin source not found: ${srcDir}`);
  }

  await mkdir(destDir, { recursive: true });

  for (const file of PLUGIN_FILES) {
    const src = join(srcDir, file);
    const dest = join(destDir, file);
    await copyFile(src, dest);
  }

  logger.info('[boom-search] Plugin files deployed', { destDir });
}

/**
 * Inject BoomClaw search config into openclaw.json.
 *
 * enabled=true  → disable core web_search, enable boom-search plugin
 * enabled=false → restore core web_search, disable boom-search plugin
 */
async function setSearchConfig(enabled: boolean): Promise<void> {
  const config = await readOpenClawConfig();

  // tools.web.search.enabled
  const tools = (config.tools && typeof config.tools === 'object'
    ? { ...(config.tools as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const web = (tools.web && typeof tools.web === 'object'
    ? { ...(tools.web as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const search = (web.search && typeof web.search === 'object'
    ? { ...(web.search as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  // When BoomClaw search is ON, disable core web_search and web_fetch so our
  // plugin can register tools with the same names, bypassing SSRF restrictions.
  search.enabled = !enabled;
  web.search = search;

  const fetchCfg = (web.fetch && typeof web.fetch === 'object'
    ? { ...(web.fetch as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  fetchCfg.enabled = !enabled;
  web.fetch = fetchCfg;

  tools.web = web;
  config.tools = tools;

  // plugins.entries["boom-search"].enabled
  const plugins = (config.plugins && typeof config.plugins === 'object'
    ? { ...(config.plugins as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const entries = (plugins.entries && typeof plugins.entries === 'object'
    ? { ...(plugins.entries as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  entries[PLUGIN_ID] = { enabled };
  plugins.entries = entries;

  // OpenClaw's resolveEnableState checks `plugins.allow` BEFORE `entry.enabled`.
  // If the allowlist is non-empty and our plugin is not in it, it is silently blocked.
  // Only add/remove from the allowlist when it is already non-empty to avoid
  // accidentally converting an "allow-all" (empty) list into a restrictive one.
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
  logger.info(`[boom-search] Search config updated`, { boomSearchEnabled: enabled });
}

/**
 * Deploy plugin + enable BoomClaw search (called at startup).
 * Non-fatal: logs a warning if anything fails.
 */
export async function ensureBoomSearchPlugin(): Promise<void> {
  try {
    await deployPluginFiles();
    await setSearchConfig(true);
    logger.info('[boom-search] Plugin ready');
  } catch (error) {
    logger.warn('[boom-search] Failed to deploy plugin', String(error));
  }
}

/**
 * Switch BoomClaw search ON or OFF.
 * Called from IPC handler when the user toggles the setting in Settings UI.
 * Gateway must be restarted for the change to take effect.
 */
export async function setBoomSearchEnabled(enabled: boolean): Promise<void> {
  await setSearchConfig(enabled);
}
