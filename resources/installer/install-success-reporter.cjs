const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const BAKED_BASE_URL = 'https://sd6sccbpgrokt7kpdca6g.apigateway-cn-beijing.volceapi.com'
const BAKED_REPORT_PATH = '/data-analysis-records'

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

function toPositiveInteger(input) {
  const value = Number.parseInt(String(input || '0'), 10)
  return Number.isFinite(value) && value > 0 ? value : 0
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

async function ensureDir(targetDir) {
  await fs.mkdir(targetDir, { recursive: true })
}

async function getOrCreateAnonymousDeviceId(telemetryDir) {
  const deviceIdPath = path.join(telemetryDir, 'anonymous-device-id.txt')
  try {
    const existing = (await fs.readFile(deviceIdPath, 'utf8')).trim()
    if (existing) return existing
  } catch {
    // Ignore missing file and create a new one below.
  }

  const created = crypto.randomUUID()
  await ensureDir(telemetryDir)
  await fs.writeFile(deviceIdPath, `${created}\n`, 'utf8')
  return created
}

function readRegistryValue(key, valueName) {
  try {
    const output = execFileSync(
      'reg.exe',
      ['QUERY', key, '/v', valueName],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
        windowsHide: true,
      },
    )

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of lines) {
      if (!line.toLowerCase().startsWith(valueName.toLowerCase())) continue
      const parts = line.split(/\s{2,}/).filter(Boolean)
      if (parts.length >= 3) {
        return sanitizeText(parts.slice(2).join(' '))
      }
    }
  } catch {
    // Best-effort only.
  }

  return ''
}

function resolveMachineInfo() {
  const manufacturer = readRegistryValue(
    'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS',
    'SystemManufacturer',
  )
  const model = readRegistryValue(
    'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS',
    'SystemProductName',
  )
  const cpuModel = sanitizeText(os.cpus()?.[0]?.model || '')

  return {
    manufacturer: manufacturer || undefined,
    model: model || undefined,
    cpuModel: cpuModel || undefined,
    cpuCount: Array.isArray(os.cpus()) ? os.cpus().length : undefined,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
  }
}

async function buildPayload(args, telemetryDir) {
  const version = sanitizeText(args.version)
  const productName = sanitizeText(args['product-name'] || 'StoryClaw')
  const appId = sanitizeText(args['app-id'] || 'app.storyclaw.desktop')
  const appSlug = sanitizeText(args['app-slug'] || 'storyclaw') || 'storyclaw'
  const channel = sanitizeText(args.channel || 'stable') || 'stable'
  const source = sanitizeText(args.source || 'nsis') || 'nsis'
  const installDurationMs = toPositiveInteger(args['install-duration-ms'])
  const anonymousDeviceId = await getOrCreateAnonymousDeviceId(telemetryDir)

  return {
    event: 'install_success',
    installId: crypto.randomUUID(),
    anonymousDeviceId,
    app: {
      id: appId,
      slug: appSlug,
      productName,
      version: version || undefined,
      channel,
      source,
    },
    installation: {
      durationMs: installDurationMs,
      completedAt: new Date().toISOString(),
    },
    system: {
      platform: 'win32',
      arch: os.arch(),
      release: os.release(),
      version: typeof os.version === 'function' ? sanitizeText(os.version()) : undefined,
      ...resolveMachineInfo(),
    },
  }
}

function buildReportUrl(baseUrl, reportPath) {
  if (!baseUrl) return ''
  return new URL(reportPath, `${baseUrl}/`).toString()
}

async function writePendingFile(telemetryDir, pending) {
  const pendingPath = path.join(telemetryDir, 'pending-install-success.json')
  await ensureDir(telemetryDir)
  await fs.writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
}

async function clearPendingFile(telemetryDir) {
  const pendingPath = path.join(telemetryDir, 'pending-install-success.json')
  try {
    await fs.unlink(pendingPath)
  } catch {
    // Ignore missing file.
  }
}

function generateEventId() {
  return `evt_${crypto.randomBytes(5).toString('hex')}`
}

function buildRequestBody(payload) {
  return {
    event_id: generateEventId(),
    event_name: 'install_complete',
    event_time: new Date().toISOString(),
    payload,
  }
}

async function sendInstallReport(reportUrl, requestBody, appVersion) {
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(5000)
    : undefined

  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `StoryClaw-Installer/${appVersion || 'unknown'}`,
    },
    body: JSON.stringify(requestBody),
    signal: timeoutSignal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return { status: response.status }
}

async function main() {
  const args = parseArgs(process.argv)
  const appSlug = sanitizeText(args['app-slug'] || 'storyclaw') || 'storyclaw'
  const telemetryDir = resolveTelemetryDir(args, appSlug)
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
  let payload = null
  let requestBody = null

  try {
    payload = await buildPayload(args, telemetryDir)
    requestBody = buildRequestBody(payload)
    if (!reportUrl) {
      throw new Error('business base URL is empty')
    }

    const result = await sendInstallReport(reportUrl, requestBody, payload.app.version)
    await clearPendingFile(telemetryDir)
    void result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (payload) {
      await writePendingFile(telemetryDir, {
        event: payload.event,
        reportUrl,
        createdAt: new Date().toISOString(),
        error: message,
        payload,
      })
    }
    process.exitCode = 1
  }
}

void main()
