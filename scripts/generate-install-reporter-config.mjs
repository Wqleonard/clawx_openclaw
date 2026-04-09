import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPORTER_PATH = resolve(ROOT, 'resources', 'installer', 'install-success-reporter.cjs');
const OPEN_REPORTER_PATH = resolve(ROOT, 'resources', 'installer', 'install-open-reporter.cjs');
const INSTALLER_NSH_PATH = resolve(ROOT, 'scripts', 'installer.nsh');
const BASE_URL_TOKEN = '__INSTALL_REPORT_BASE_URL__';
const REPORT_PATH_TOKEN = '__INSTALL_REPORT_PATH__';
const DEBUG_LOG_TOKEN = '__INSTALL_DEBUG_LOG_ENABLED__';
const DEFAULT_REPORT_PATH = '/data-analysis-records';

function parseArgs(argv) {
  const args = {
    restore: false,
    mode: '',
    baseUrl: '',
    reportPath: '',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--restore') {
      args.restore = true;
      continue;
    }
    if (current === '--mode' && argv[i + 1]) {
      args.mode = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (current === '--base-url' && argv[i + 1]) {
      args.baseUrl = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (current === '--report-path' && argv[i + 1]) {
      args.reportPath = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
  }
  return args;
}

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

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeReportPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_REPORT_PATH;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function resolveBuildMode(args) {
  return (
    args.mode
    || process.env.MODE
    || process.env.VITE_MODE
    || process.env.BUILD_MODE
    || 'prd'
  ).trim();
}

function resolveBuildBaseUrl(args, mode) {
  const fromArg = normalizeBaseUrl(args.baseUrl);
  if (fromArg) return fromArg;

  const fromEnv = normalizeBaseUrl(
    process.env.VITE_BUSINESS_API_BASE_URL
    || process.env.BUSINESS_API_BASE_URL
    || '',
  );
  if (fromEnv) return fromEnv;

  const modeEnv = parseEnvFile(resolve(ROOT, `.env.${mode}`));
  const fromModeEnv = normalizeBaseUrl(
    modeEnv.VITE_BUSINESS_API_BASE_URL
    || modeEnv.BUSINESS_API_BASE_URL
    || '',
  );
  if (fromModeEnv) return fromModeEnv;

  const prdEnv = parseEnvFile(resolve(ROOT, '.env.prd'));
  return normalizeBaseUrl(prdEnv.VITE_BUSINESS_API_BASE_URL || prdEnv.BUSINESS_API_BASE_URL || '');
}

function resolveBuildReportPath(args) {
  return normalizeReportPath(args.reportPath || process.env.INSTALL_SUCCESS_REPORT_PATH || DEFAULT_REPORT_PATH);
}

function escapeForSingleQuotedJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function restoreReporterSource(source) {
  const restored = source
    .replace(/const BAKED_BASE_URL = '[^']*'/g, `const BAKED_BASE_URL = '${BASE_URL_TOKEN}'`)
    .replace(/const BAKED_REPORT_PATH = '[^']*'/g, `const BAKED_REPORT_PATH = '${REPORT_PATH_TOKEN}'`);
  return restored.replace(
    /(const BAKED_BASE_URL = '__INSTALL_REPORT_BASE_URL__'\r?\nconst BAKED_REPORT_PATH = '__INSTALL_REPORT_PATH__'\r?\n)(?:const BAKED_BASE_URL = '__INSTALL_REPORT_BASE_URL__'\r?\nconst BAKED_REPORT_PATH = '__INSTALL_REPORT_PATH__'\r?\n)+/g,
    '$1',
  );
}

function restoreInstallerSource(source) {
  return source
    .replace(/!define INSTALL_OPEN_BASE_URL "[^\r\n]*"/g, `!define INSTALL_OPEN_BASE_URL "${BASE_URL_TOKEN}"`)
    .replace(/!define INSTALL_OPEN_PATH "[^\r\n]*"/g, `!define INSTALL_OPEN_PATH "${REPORT_PATH_TOKEN}"`)
    .replace(/!define INSTALL_DEBUG_LOG_ENABLED "[^\r\n]*"/g, `!define INSTALL_DEBUG_LOG_ENABLED "${DEBUG_LOG_TOKEN}"`);
}

function resolveDebugLogEnabled(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  return normalized === 'dev' || normalized === 'qa' ? '1' : '0';
}

async function main() {
  const args = parseArgs(process.argv);
  const reporterSource = readFileSync(REPORTER_PATH, 'utf8');
  const openReporterSource = readFileSync(OPEN_REPORTER_PATH, 'utf8');
  const installerSource = readFileSync(INSTALLER_NSH_PATH, 'utf8');
  const restoredReporterSource = restoreReporterSource(reporterSource);
  const restoredOpenReporterSource = restoreReporterSource(openReporterSource);
  const restoredInstallerSource = restoreInstallerSource(installerSource);

  if (args.restore) {
    writeFileSync(REPORTER_PATH, restoredReporterSource, 'utf8');
    writeFileSync(OPEN_REPORTER_PATH, restoredOpenReporterSource, 'utf8');
    writeFileSync(INSTALLER_NSH_PATH, restoredInstallerSource, 'utf8');
    console.log('[install-reporter-config] reporters + installer placeholders restored.');
    return;
  }

  const mode = resolveBuildMode(args);
  const baseUrl = resolveBuildBaseUrl(args, mode);
  const reportPath = resolveBuildReportPath(args);
  const escapedBaseUrl = escapeForSingleQuotedJs(baseUrl);
  const escapedReportPath = escapeForSingleQuotedJs(reportPath);
  const nshBaseUrl = baseUrl.replace(/"/g, '');
  const nshReportPath = reportPath.replace(/"/g, '');
  const debugLogEnabled = resolveDebugLogEnabled(mode);
  const bakedReporterSource = restoredReporterSource
    .replace(`const BAKED_BASE_URL = '${BASE_URL_TOKEN}'`, `const BAKED_BASE_URL = '${escapedBaseUrl}'`)
    .replace(`const BAKED_REPORT_PATH = '${REPORT_PATH_TOKEN}'`, `const BAKED_REPORT_PATH = '${escapedReportPath}'`);
  const bakedOpenReporterSource = restoredOpenReporterSource
    .replace(`const BAKED_BASE_URL = '${BASE_URL_TOKEN}'`, `const BAKED_BASE_URL = '${escapedBaseUrl}'`)
    .replace(`const BAKED_REPORT_PATH = '${REPORT_PATH_TOKEN}'`, `const BAKED_REPORT_PATH = '${escapedReportPath}'`);
  const bakedInstallerSource = restoredInstallerSource
    .replace(`!define INSTALL_OPEN_BASE_URL "${BASE_URL_TOKEN}"`, `!define INSTALL_OPEN_BASE_URL "${nshBaseUrl}"`)
    .replace(`!define INSTALL_OPEN_PATH "${REPORT_PATH_TOKEN}"`, `!define INSTALL_OPEN_PATH "${nshReportPath}"`)
    .replace(`!define INSTALL_DEBUG_LOG_ENABLED "${DEBUG_LOG_TOKEN}"`, `!define INSTALL_DEBUG_LOG_ENABLED "${debugLogEnabled}"`);

  writeFileSync(REPORTER_PATH, bakedReporterSource, 'utf8');
  writeFileSync(OPEN_REPORTER_PATH, bakedOpenReporterSource, 'utf8');
  writeFileSync(INSTALLER_NSH_PATH, bakedInstallerSource, 'utf8');
  console.log('[install-reporter-config] bake done (no network call at build time).');

  if (!baseUrl) {
    console.warn('[install-reporter-config] baked baseUrl is empty; runtime install_open/install_complete reports may fallback to local pending.');
  } else {
    console.log(`[install-reporter-config] reporter baked baseUrl: ${baseUrl}`);
  }
  console.log(`[install-reporter-config] reporter baked reportPath: ${reportPath}`);
  console.log(`[install-reporter-config] reporter baked mode: ${mode}`);
  console.log(`[install-reporter-config] installer debug log enabled: ${debugLogEnabled}`);
}

await main();
