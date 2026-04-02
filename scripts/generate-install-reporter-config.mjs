import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPORTER_PATH = resolve(ROOT, 'resources', 'installer', 'install-success-reporter.cjs');
const INSTALLER_NSH_PATH = resolve(ROOT, 'scripts', 'installer.nsh');
const BASE_URL_TOKEN = '__INSTALL_REPORT_BASE_URL__';
const REPORT_PATH_TOKEN = '__INSTALL_REPORT_PATH__';
const SHOULD_RESTORE = process.argv.includes('--restore');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}

function resolveBuildBaseUrl() {
  const envFromProcess = (
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || ''
  ).trim();
  if (envFromProcess) return envFromProcess;

  const mode = (process.env.MODE || process.env.VITE_MODE || 'prd').trim();
  const modeEnvFile = resolve(ROOT, `.env.${mode}`);
  const modeEnv = parseEnvFile(modeEnvFile);
  const fromModeEnv = (modeEnv.VITE_BUSINESS_API_BASE_URL || modeEnv.BUSINESS_API_BASE_URL || '').trim();
  if (fromModeEnv) return fromModeEnv;

  const prdEnv = parseEnvFile(resolve(ROOT, '.env.prd'));
  return (prdEnv.VITE_BUSINESS_API_BASE_URL || prdEnv.BUSINESS_API_BASE_URL || '').trim();
}

const baseUrl = resolveBuildBaseUrl().replace(/\/+$/, '');
const reportPath = (process.env.INSTALL_SUCCESS_REPORT_PATH || '/data-analysis-records').trim();

const reporterSource = readFileSync(REPORTER_PATH, 'utf8');
const restoredSource = reporterSource
  .replace(/const BAKED_BASE_URL = '[^']*'/, `const BAKED_BASE_URL = '${BASE_URL_TOKEN}'`)
  .replace(/const BAKED_REPORT_PATH = '[^']*'/, `const BAKED_REPORT_PATH = '${REPORT_PATH_TOKEN}'`);
const installerSource = readFileSync(INSTALLER_NSH_PATH, 'utf8');
const restoredInstallerSource = installerSource
  .replace(/!define INSTALL_OPEN_BASE_URL ".*"/, `!define INSTALL_OPEN_BASE_URL "${BASE_URL_TOKEN}"`)
  .replace(/!define INSTALL_OPEN_PATH ".*"/, `!define INSTALL_OPEN_PATH "${REPORT_PATH_TOKEN}"`);

if (SHOULD_RESTORE) {
  writeFileSync(REPORTER_PATH, restoredSource, 'utf8');
  writeFileSync(INSTALLER_NSH_PATH, restoredInstallerSource, 'utf8');
  console.log('[install-reporter-config] reporter placeholders restored.');
  process.exit(0);
}

const escapedBaseUrl = baseUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const escapedReportPath = (reportPath || '/data-analysis-records').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const nshBaseUrl = baseUrl.replace(/"/g, '');
const nshReportPath = (reportPath || '/data-analysis-records').replace(/"/g, '');

const bakedSource = restoredSource
  .replace(`const BAKED_BASE_URL = '${BASE_URL_TOKEN}'`, `const BAKED_BASE_URL = '${escapedBaseUrl}'`)
  .replace(`const BAKED_REPORT_PATH = '${REPORT_PATH_TOKEN}'`, `const BAKED_REPORT_PATH = '${escapedReportPath}'`);
const bakedInstallerSource = restoredInstallerSource
  .replace(`!define INSTALL_OPEN_BASE_URL "${BASE_URL_TOKEN}"`, `!define INSTALL_OPEN_BASE_URL "${nshBaseUrl}"`)
  .replace(`!define INSTALL_OPEN_PATH "${REPORT_PATH_TOKEN}"`, `!define INSTALL_OPEN_PATH "${nshReportPath}"`);

writeFileSync(REPORTER_PATH, bakedSource, 'utf8');
writeFileSync(INSTALLER_NSH_PATH, bakedInstallerSource, 'utf8');

if (!baseUrl) {
  console.warn('[install-reporter-config] baked baseUrl is empty; installer will fallback to pending only.');
} else {
  console.log(`[install-reporter-config] reporter baked baseUrl: ${baseUrl}`);
}
console.log(`[install-reporter-config] reporter baked reportPath: ${escapedReportPath}`);
