const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const BAKED_BASE_URL = '__INSTALL_REPORT_BASE_URL__'
const BAKED_REPORT_PATH = '__INSTALL_REPORT_PATH__'

function parseArgs(argv) {
  const result = {}
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) continue
    const key = current.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }
    result[key] = next
    index += 1
  }
  return result
}

function normalizeBaseUrl(input) {
  return String(input || '').trim().replace(/\/+$/, '')
}

function normalizeReportPath(input) {
  const raw = String(input || '').trim()
  if (!raw) return '/data-analysis-records'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function sanitizeText(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function getTelemetryDir(appSlug) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, appSlug, 'telemetry')
}

function resolveTelemetryDir(args, appSlug) {
  const fromArg = String(args['telemetry-dir'] || '').trim()
  if (fromArg) return fromArg
  return getTelemetryDir(appSlug)
}

function resolveDebugLogPath(args, appSlug, telemetryDir) {
  const explicitDir = String(args['debug-log-dir'] || '').trim()
  if (explicitDir) return path.join(explicitDir, 'install-open-reporter.log')
  return ''
}

async function ensureDir(targetDir) {
  await fs.mkdir(targetDir, { recursive: true })
}

async function appendDebugLog(debugLogPath, message) {
  if (!debugLogPath) return
  try {
    await ensureDir(path.dirname(debugLogPath))
    await fs.appendFile(debugLogPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // Best-effort only.
  }
}

function buildReportUrl(baseUrl, reportPath) {
  if (!baseUrl) return ''
  return new URL(reportPath, `${baseUrl}/`).toString()
}

function buildRequestBody(payload) {
  return {
    event_id: `evt_open_${crypto.randomBytes(5).toString('hex')}`,
    event_name: 'install_open',
    event_time: new Date().toISOString(),
    payload,
  }
}

async function sendInstallOpen(reportUrl, requestBody, appVersion) {
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(4000)
    : undefined

  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `StoryClaw-Installer-Open/${appVersion || 'unknown'}`,
    },
    body: JSON.stringify(requestBody),
    signal: timeoutSignal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}

async function writePendingFile(telemetryDir, pending) {
  const pendingPath = path.join(telemetryDir, 'pending-install-open.json')
  await ensureDir(telemetryDir)
  await fs.writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv)
  const appSlug = sanitizeText(args['app-slug'] || 'storyclaw') || 'storyclaw'
  const appId = sanitizeText(args['app-id'] || 'app.storyclaw.desktop')
  const productName = sanitizeText(args['product-name'] || 'StoryClaw')
  const version = sanitizeText(args.version)
  const source = sanitizeText(args.source || 'nsis_init') || 'nsis_init'
  const telemetryDir = resolveTelemetryDir(args, appSlug)
  const debugLogPath = resolveDebugLogPath(args, appSlug, telemetryDir)
  const bakedBaseUrl = BAKED_BASE_URL === '__INSTALL_REPORT_BASE_URL__' ? '' : BAKED_BASE_URL
  const bakedReportPath = BAKED_REPORT_PATH === '__INSTALL_REPORT_PATH__'
    ? '/data-analysis-records'
    : BAKED_REPORT_PATH
  const baseUrl = normalizeBaseUrl(
    args['base-url']
    || bakedBaseUrl
    || process.env.BUSINESS_API_BASE_URL
    || process.env.VITE_BUSINESS_API_BASE_URL,
  )
  const reportPath = normalizeReportPath(args['report-path'] || bakedReportPath)
  const reportUrl = buildReportUrl(baseUrl, reportPath)
  const payload = {
    source,
    app: {
      id: appId,
      slug: appSlug,
      productName,
      version: version || undefined,
    },
  }

  await appendDebugLog(debugLogPath, `[install_open] reportUrl=${reportUrl || '(empty)'}`)
  await appendDebugLog(debugLogPath, `[install_open] payload=${JSON.stringify(payload)}`)

  try {
    if (!reportUrl) throw new Error('business base URL is empty')
    const requestBody = buildRequestBody(payload)
    await sendInstallOpen(reportUrl, requestBody, version)
    await appendDebugLog(debugLogPath, '[install_open] send result=ok')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendDebugLog(debugLogPath, `[install_open] send result=err:${message}`)
    await writePendingFile(telemetryDir, {
      event: 'install_open',
      reportUrl,
      createdAt: new Date().toISOString(),
      error: message,
      payload,
    })
    process.exitCode = 1
  }
}

void main()
