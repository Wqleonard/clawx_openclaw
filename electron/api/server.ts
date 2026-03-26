import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleSkillHubRoutes } from './routes/skillhub';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { handleBoomSearchRoutes } from './routes/boom-search';
import { handleAiExecAuditRoutes } from './routes/ai-exec-audit';
import { handlePluginRuntimeConfigRoutes } from './routes/plugin-runtime-config';
import { sendJson } from './route-utils';

const execAsync = promisify(execCb);
let activeHostApiPort: number = PORTS.CLAWX_HOST_API;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleSkillHubRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleBoomSearchRoutes,
  handleAiExecAuditRoutes,
  handlePluginRuntimeConfigRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EADDRINUSE',
  );
}

async function getListeningProcessIds(port: number): Promise<number[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`, {
        timeout: 5000,
        windowsHide: true,
      });
      const pids = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+/))
        .filter((parts) => parts.length >= 5 && parts[3] === 'LISTENING')
        .map((parts) => Number.parseInt(parts[4], 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
      return [...new Set(pids)];
    }

    const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t`, { timeout: 5000 });
    const pids = stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
    return [...new Set(pids)];
  } catch {
    return [];
  }
}

async function getProcessFingerprint(pid: number): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress)"`,
        { timeout: 5000, windowsHide: true },
      );
      return stdout.trim().toLowerCase();
    }

    const { stdout } = await execAsync(`ps -p ${pid} -o command=`, { timeout: 5000 });
    return stdout.trim().toLowerCase();
  } catch {
    return '';
  }
}

function isRecoverableLegacyStoryClawProcess(fingerprint: string): boolean {
  if (!fingerprint) return false;
  return (
    fingerprint.includes('storyclaw')
    || fingerprint.includes('clawx')
    || fingerprint.includes('openclaw')
    || fingerprint.includes('storyclaw.exe')
    || fingerprint.includes('clawx.exe')
  );
}

async function terminateProcessTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execAsync(`taskkill /F /PID ${pid} /T`, {
        timeout: 5000,
        windowsHide: true,
      });
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // already exited
    }
  } catch {
    // best effort
  }
}

async function recoverHostApiPort(port: number, currentPid: number): Promise<boolean> {
  const listeners = await getListeningProcessIds(port);
  const stalePids = listeners.filter((pid) => pid !== currentPid);
  if (stalePids.length === 0) {
    return false;
  }

  const killCandidates: number[] = [];
  for (const pid of stalePids) {
    const fingerprint = await getProcessFingerprint(pid);
    if (isRecoverableLegacyStoryClawProcess(fingerprint)) {
      killCandidates.push(pid);
    } else {
      logger.warn(`Host API port ${port} occupied by non-StoryClaw process pid=${pid}; skip auto-terminate`);
    }
  }

  if (killCandidates.length === 0) {
    return false;
  }

  logger.warn(
    `Host API port ${port} occupied by stale process(es) [${killCandidates.join(', ')}], attempting cleanup before retry`,
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const pid of killCandidates) {
      await terminateProcessTree(pid);
    }
    await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 1200 : 600));
    const remaining = (await getListeningProcessIds(port)).filter((pid) => pid !== currentPid);
    if (remaining.length === 0) {
      return true;
    }
    logger.warn(
      `Host API port ${port} still occupied after cleanup attempt ${attempt} (pids=${remaining.join(', ')})`,
    );
  }
  return false;
}

function createHostApiServer(ctx: HostApiContext, port: number): Server {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });
  return server;
}

async function listenHostApiServer(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Host API listening address is unavailable');
  }
  return address.port;
}

async function findFallbackHostApiPort(basePort: number): Promise<number> {
  for (let candidate = basePort + 1; candidate <= basePort + 30; candidate += 1) {
    const probe = createServer();
    try {
      const boundPort = await listenHostApiServer(probe, candidate);
      probe.close();
      return boundPort;
    } catch {
      try {
        probe.close();
      } catch {
        // ignore
      }
    }
  }

  const probe = createServer();
  const ephemeralPort = await listenHostApiServer(probe, 0);
  probe.close();
  return ephemeralPort;
}

export function getActiveHostApiPort(): number {
  return activeHostApiPort;
}

export async function startHostApiServer(ctx: HostApiContext, port = PORTS.CLAWX_HOST_API): Promise<Server> {
  let server = createHostApiServer(ctx, port);
  try {
    const boundPort = await listenHostApiServer(server, port);
    activeHostApiPort = boundPort;
    logger.info(`Host API server listening on http://127.0.0.1:${boundPort}`);
    return server;
  } catch (error) {
    if (!isAddressInUseError(error)) {
      throw error;
    }
  }

  const recovered = await recoverHostApiPort(port, process.pid);
  if (!recovered) {
    throw new Error(`Host API port ${port} is already in use and could not be recovered`);
  }

  try {
    server.close();
  } catch {
    // ignore if not open
  }
  server = createHostApiServer(ctx, port);
  try {
    const recoveredPort = await listenHostApiServer(server, port);
    activeHostApiPort = recoveredPort;
    logger.info(`Host API server recovered and listening on http://127.0.0.1:${recoveredPort}`);
    return server;
  } catch (error) {
    if (!isAddressInUseError(error)) {
      throw error;
    }
  }

  const fallbackPort = await findFallbackHostApiPort(port);
  server = createHostApiServer(ctx, fallbackPort);
  const boundFallbackPort = await listenHostApiServer(server, fallbackPort);
  activeHostApiPort = boundFallbackPort;
  logger.warn(
    `Host API default port ${port} unavailable; switched to fallback port ${boundFallbackPort} to keep app functional`,
  );

  return server;
}
