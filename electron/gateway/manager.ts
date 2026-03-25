/**
 * Gateway Process Manager
 * Manages the OpenClaw Gateway process lifecycle
 */
import { app } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { access, copyFile, readFile, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { PORTS } from '../utils/config';
import { JsonRpcNotification, isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import {
  normalizeChatRecordSource,
  resolveChatRecordTypeBySource,
  writeGatewayRawMessage,
  writeChatRecord,
  type ChatRecordSource,
} from '../utils/chat-record-logger';
import { captureTelemetryEvent, trackMetric } from '../utils/telemetry';
import {
  loadOrCreateDeviceIdentity,
  type DeviceIdentity,
} from '../utils/device-identity';
import { getOpenClawConfigDir } from '../utils/paths';
import {
  DEFAULT_RECONNECT_CONFIG,
  type ReconnectConfig,
  type GatewayLifecycleState,
  getReconnectScheduleDecision,
  getReconnectSkipReason,
} from './process-policy';
import {
  clearPendingGatewayRequests,
  rejectPendingGatewayRequest,
  resolvePendingGatewayRequest,
  type PendingGatewayRequest,
} from './request-store';
import { dispatchJsonRpcNotification, dispatchProtocolEvent } from './event-dispatch';
import { GatewayStateController } from './state';
import { prepareGatewayLaunchContext } from './config-sync';
import { connectGatewaySocket, waitForGatewayReady } from './ws-client';
import {
  clearStaleGatewayLockFiles,
  findExistingGatewayProcess,
  runOpenClawDoctorRepair,
  terminateOwnedGatewayProcess,
  unloadLaunchctlGatewayService,
  waitForPortFree,
  warmupManagedPythonReadiness,
} from './supervisor';
import { GatewayConnectionMonitor } from './connection-monitor';
import { GatewayLifecycleController, LifecycleSupersededError } from './lifecycle-controller';
import { launchGatewayProcess } from './process-launcher';
import { GatewayRestartController } from './restart-controller';
import { GatewayRestartGovernor } from './restart-governor';
import {
  DEFAULT_GATEWAY_RELOAD_POLICY,
  loadGatewayReloadPolicy,
  type GatewayReloadPolicy,
} from './reload-policy';
import { classifyGatewayStderrMessage, recordGatewayStartupStderrLine } from './startup-stderr';
import { runGatewayStartupSequence } from './startup-orchestrator';

export interface GatewayStatus {
  state: GatewayLifecycleState;
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
}

/**
 * Gateway Manager Events
 */
export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'channel:status': (data: { channelId: string; status: string }) => void;
  'chat:message': (data: { message: unknown }) => void;
}

/**
 * Gateway Manager
 * Handles starting, stopping, and communicating with the OpenClaw Gateway
 */
export class GatewayManager extends EventEmitter {
  private process: Electron.UtilityProcess | null = null;
  private processExitCode: number | null = null; // set by exit event, replaces exitCode/signalCode
  private ownsProcess = false;
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: PORTS.OPENCLAW_GATEWAY };
  private readonly stateController: GatewayStateController;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectConfig: ReconnectConfig;
  private shouldReconnect = true;
  private startLock = false;
  private lastSpawnSummary: string | null = null;
  private recentStartupStderrLines: string[] = [];
  private pendingRequests: Map<string, PendingGatewayRequest> = new Map();
  private deviceIdentity: DeviceIdentity | null = null;
  private restartInFlight: Promise<void> | null = null;
  private readonly connectionMonitor = new GatewayConnectionMonitor();
  private readonly lifecycleController = new GatewayLifecycleController();
  private readonly restartController = new GatewayRestartController();
  private readonly restartGovernor = new GatewayRestartGovernor();
  private reloadDebounceTimer: NodeJS.Timeout | null = null;
  private reloadPolicy: GatewayReloadPolicy = { ...DEFAULT_GATEWAY_RELOAD_POLICY };
  private reloadPolicyLoadedAt = 0;
  private reloadPolicyRefreshPromise: Promise<void> | null = null;
  private externalShutdownSupported: boolean | null = null;
  private reconnectAttemptsTotal = 0;
  private reconnectSuccessTotal = 0;
  private recentUserRecordKeys: Map<string, number> = new Map();
  private sessionSourceHints: Map<string, ChatRecordSource> = new Map();
  private sessionFallbackInflight: Set<string> = new Set();
  private readonly userRecordStartAtMs = Date.now();
  private static readonly RELOAD_POLICY_REFRESH_MS = 15_000;
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;
  private static readonly HEARTBEAT_TIMEOUT_MS = 12_000;
  private static readonly HEARTBEAT_MAX_MISSES = 3;
  private static readonly USER_RECORD_DEDUPE_TTL_MS = 5 * 60_000;
  private static readonly USER_RECORD_CLOCK_SKEW_MS = 60_000;
  public static readonly RESTART_COOLDOWN_MS = 5_000;
  private lastRestartAt = 0;

  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.stateController = new GatewayStateController({
      emitStatus: (status) => {
        this.status = status;
        this.emit('status', status);
      },
      onTransition: (previousState, nextState) => {
        if (nextState === 'running') {
          this.restartGovernor.onRunning();
        }
        this.restartController.flushDeferredRestart(
          `status:${previousState}->${nextState}`,
          {
            state: this.status.state,
            startLock: this.startLock,
            shouldReconnect: this.shouldReconnect,
          },
          () => {
            void this.restart().catch((error) => {
              logger.warn('Deferred Gateway restart failed:', error);
            });
          },
        );
      },
    });
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
    // Device identity is loaded lazily in start() — not in the constructor —
    // so that async file I/O and key generation don't block module loading.
  }

  private async initDeviceIdentity(): Promise<void> {
    if (this.deviceIdentity) return; // already loaded
    try {
      const userDataDir = app.getPath('userData');
      const identityPath = path.join(userDataDir, 'storyclaw-device-identity.json');
      const legacyIdentityPath = path.join(userDataDir, 'clawx-device-identity.json');

      try {
        await access(identityPath, fsConstants.F_OK);
      } catch {
        try {
          await access(legacyIdentityPath, fsConstants.F_OK);
          await copyFile(legacyIdentityPath, identityPath);
          logger.info('Migrated legacy device identity file to storyclaw-device-identity.json');
        } catch {
          // Legacy file missing is expected for fresh installs.
        }
      }

      this.deviceIdentity = await loadOrCreateDeviceIdentity(identityPath);
      logger.debug(`Device identity loaded (deviceId=${this.deviceIdentity.deviceId})`);

      try {
        await access(legacyIdentityPath, fsConstants.F_OK);
        await unlink(legacyIdentityPath);
        logger.info('Removed legacy device identity file clawx-device-identity.json after migration');
      } catch {
        // Ignore cleanup failures; identity loading already succeeded.
      }
    } catch (err) {
      logger.warn('Failed to load device identity, scopes will be limited:', err);
    }
  }

  private sanitizeSpawnArgs(args: string[]): string[] {
    const sanitized = [...args];
    const tokenIdx = sanitized.indexOf('--token');
    if (tokenIdx !== -1 && tokenIdx + 1 < sanitized.length) {
      sanitized[tokenIdx + 1] = '[redacted]';
    }
    return sanitized;
  }

  private isUnsupportedShutdownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /unknown method:\s*shutdown/i.test(message);
  }
  /**
   * Get current Gateway status
   */
  getStatus(): GatewayStatus {
    return this.stateController.getStatus();
  }

  /**
   * Check if Gateway is connected and ready
   */
  isConnected(): boolean {
    return this.stateController.isConnected(this.ws?.readyState === WebSocket.OPEN);
  }

  /**
   * Start Gateway process
   */
  async start(): Promise<void> {
    if (this.startLock) {
      logger.debug('Gateway start ignored because a start flow is already in progress');
      return;
    }

    if (this.status.state === 'running') {
      logger.debug('Gateway already running, skipping start');
      return;
    }

    this.startLock = true;
    const startEpoch = this.lifecycleController.bump('start');
    logger.info(`Gateway start requested (port=${this.status.port})`);
    this.lastSpawnSummary = null;
    this.shouldReconnect = true;
    await this.refreshReloadPolicy(true);

    // Lazily load device identity (async file I/O + key generation).
    // Must happen before connect() which uses the identity for the handshake.
    await this.initDeviceIdentity();

    // Manual start should override and cancel any pending reconnect timer.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      logger.debug('Cleared pending reconnect timer because start was requested manually');
    }

    this.reconnectAttempts = 0;
    this.setStatus({ state: 'starting', reconnectAttempts: 0 });

    // Check if Python environment is ready (self-healing) asynchronously.
    // Fire-and-forget: only needs to run once, not on every retry.
    warmupManagedPythonReadiness();

    try {
      await runGatewayStartupSequence({
        port: this.status.port,
        ownedPid: this.process?.pid,
        shouldWaitForPortFree: process.platform === 'win32',
        resetStartupStderrLines: () => {
          this.recentStartupStderrLines = [];
        },
        getStartupStderrLines: () => this.recentStartupStderrLines,
        assertLifecycle: (phase) => {
          this.lifecycleController.assert(startEpoch, phase);
        },
        findExistingGateway: async (port, ownedPid) => {
          return await findExistingGatewayProcess({ port, ownedPid });
        },
        connect: async (port, externalToken) => {
          await this.connect(port, externalToken);
        },
        onConnectedToExistingGateway: () => {

          // If the existing gateway is actually our own spawned UtilityProcess
          // (e.g. after a self-restart code=1012), keep ownership so that
          // stop() can still terminate the process during a restart() cycle.
          const isOwnProcess = this.process?.pid != null && this.ownsProcess;
          if (!isOwnProcess) {
            this.ownsProcess = false;
            this.setStatus({ pid: undefined });
          }

          this.startHealthCheck();
        },
        waitForPortFree: async (port) => {
          await waitForPortFree(port);
        },
        clearStaleLockFiles: async () => {
          await clearStaleGatewayLockFiles();
        },
        startProcess: async () => {
          await this.startProcess();
        },
        waitForReady: async (port) => {
          await waitForGatewayReady({
            port,
            getProcessExitCode: () => this.processExitCode,
          });
        },
        onConnectedToManagedGateway: () => {
          this.startHealthCheck();
          logger.debug('Gateway started successfully');
        },
        runDoctorRepair: async () => await runOpenClawDoctorRepair(),
        onDoctorRepairSuccess: () => {
          this.setStatus({ state: 'starting', error: undefined, reconnectAttempts: 0 });
        },
        delay: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        },
      });
    } catch (error) {
      if (error instanceof LifecycleSupersededError) {
        logger.debug(error.message);
        return;
      }
      logger.error(
        `Gateway start failed (port=${this.status.port}, reconnectAttempts=${this.reconnectAttempts}, spawn=${this.lastSpawnSummary ?? 'n/a'})`,
        error
      );
      this.setStatus({ state: 'error', error: String(error) });
      throw error;
    } finally {
      this.startLock = false;
      this.restartController.flushDeferredRestart(
        'start:finally',
        {
          state: this.status.state,
          startLock: this.startLock,
          shouldReconnect: this.shouldReconnect,
        },
        () => {
          void this.restart().catch((error) => {
            logger.warn('Deferred Gateway restart failed:', error);
          });
        },
      );
    }
  }

  /**
   * Stop Gateway process
   */
  async stop(): Promise<void> {
    logger.info('Gateway stop requested');
    this.lifecycleController.bump('stop');
    // Disable auto-reconnect
    this.shouldReconnect = false;

    // Clear all timers
    this.clearAllTimers();

    // If this manager is attached to an external gateway process, ask it to shut down
    // over protocol before closing the socket.
    if (!this.ownsProcess && this.ws?.readyState === WebSocket.OPEN && this.externalShutdownSupported !== false) {
      try {
        await this.rpc('shutdown', undefined, 5000);
        this.externalShutdownSupported = true;
      } catch (error) {
        if (this.isUnsupportedShutdownError(error)) {
          this.externalShutdownSupported = false;
          logger.info('External Gateway does not support "shutdown"; skipping shutdown RPC for future stops');
        } else {
          logger.warn('Failed to request shutdown for externally managed Gateway:', error);
        }
      }
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Gateway stopped by user');
      this.ws = null;
    }

    // Kill process
    if (this.process && this.ownsProcess) {
      const child = this.process;
      await terminateOwnedGatewayProcess(child);

      if (this.process === child) {
        this.process = null;
      }
    }
    this.ownsProcess = false;

    clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway stopped'));

    this.restartController.resetDeferredRestart();
    this.setStatus({ state: 'stopped', error: undefined, pid: undefined, connectedAt: undefined, uptime: undefined });
  }

  /**
   * Best-effort emergency cleanup for app-quit timeout paths.
   * Only terminates a process this manager still owns.
   */
  async forceTerminateOwnedProcessForQuit(): Promise<boolean> {
    if (!this.process || !this.ownsProcess) {
      return false;
    }

    const child = this.process;
    await terminateOwnedGatewayProcess(child);
    if (this.process === child) {
      this.process = null;
    }
    this.ownsProcess = false;
    this.setStatus({ pid: undefined });
    return true;
  }

  /**
   * Restart Gateway process
   */
  async restart(): Promise<void> {
    if (this.restartController.isRestartDeferred({
      state: this.status.state,
      startLock: this.startLock,
    })) {
      this.restartController.markDeferredRestart('restart', {
        state: this.status.state,
        startLock: this.startLock,
      });
      return;
    }

    if (this.restartInFlight) {
      logger.debug('Gateway restart already in progress, joining existing request');
      await this.restartInFlight;
      return;
    }

    const decision = this.restartGovernor.decide();
    if (!decision.allow) {
      const observability = this.restartGovernor.getObservability();
      logger.warn(
        `[gateway-restart-governor] restart suppressed reason=${decision.reason} retryAfterMs=${decision.retryAfterMs} ` +
        `suppressed=${observability.suppressed_total} executed=${observability.executed_total} circuitOpenUntil=${observability.circuit_open_until}`,
      );
      const props = {
        reason: decision.reason,
        retry_after_ms: decision.retryAfterMs,
        gateway_restart_suppressed_total: observability.suppressed_total,
        gateway_restart_executed_total: observability.executed_total,
        gateway_restart_circuit_open_until: observability.circuit_open_until,
      };
      trackMetric('gateway.restart.suppressed', props);
      captureTelemetryEvent('gateway_restart_suppressed', props);
      return;
    }

    const pidBefore = this.status.pid;
    logger.info(`[gateway-refresh] mode=restart requested pidBefore=${pidBefore ?? 'n/a'}`);
    this.restartInFlight = (async () => {
      await this.stop();
      await this.start();
    })();

    try {
      await this.restartInFlight;
      this.restartGovernor.recordExecuted();
      const observability = this.restartGovernor.getObservability();
      const props = {
        gateway_restart_executed_total: observability.executed_total,
        gateway_restart_suppressed_total: observability.suppressed_total,
        gateway_restart_circuit_open_until: observability.circuit_open_until,
      };
      trackMetric('gateway.restart.executed', props);
      captureTelemetryEvent('gateway_restart_executed', props);
      logger.info(
        `[gateway-refresh] mode=restart result=applied pidBefore=${pidBefore ?? 'n/a'} pidAfter=${this.status.pid ?? 'n/a'} ` +
        `suppressed=${observability.suppressed_total} executed=${observability.executed_total} circuitOpenUntil=${observability.circuit_open_until}`,
      );
    } finally {
      this.restartInFlight = null;
      this.restartController.flushDeferredRestart(
        'restart:finally',
        {
          state: this.status.state,
          startLock: this.startLock,
          shouldReconnect: this.shouldReconnect,
        },
        () => {
          void this.restart().catch((error) => {
            logger.warn('Deferred Gateway restart failed:', error);
          });
        },
      );
    }
  }

  /**
   * Debounced restart — coalesces multiple rapid restart requests into a
   * single restart after `delayMs` of inactivity.  This prevents the
   * cascading stop/start cycles that occur when provider:save,
   * provider:setDefault and channel:saveConfig all fire within seconds
   * of each other during setup.
   */
  debouncedRestart(delayMs = 2000): void {
    this.restartController.debouncedRestart(delayMs, () => {
      void this.restart().catch((err) => {
        logger.warn('Debounced Gateway restart failed:', err);
      });
    });
  }

  /**
   * Ask the Gateway process to reload config in-place when possible.
   * Falls back to restart on unsupported platforms or signaling failures.
   */
  async reload(): Promise<void> {
    await this.refreshReloadPolicy();

    if (this.reloadPolicy.mode === 'off' || this.reloadPolicy.mode === 'restart') {
      logger.info(
        `[gateway-refresh] mode=reload result=policy_forced_restart policy=${this.reloadPolicy.mode}`,
      );
      await this.restart();
      return;
    }

    if (this.restartController.isRestartDeferred({
      state: this.status.state,
      startLock: this.startLock,
    })) {
      this.restartController.markDeferredRestart('reload', {
        state: this.status.state,
        startLock: this.startLock,
      });
      return;
    }

    const pidBefore = this.process?.pid;
    logger.info(`[gateway-refresh] mode=reload requested pid=${pidBefore ?? 'n/a'} state=${this.status.state}`);

    if (!this.process?.pid || this.status.state !== 'running') {
      logger.warn('[gateway-refresh] mode=reload result=fallback_restart cause=not_running');
      logger.warn('Gateway reload requested while not running; falling back to restart');
      await this.restart();
      return;
    }

    if (process.platform === 'win32') {
      logger.warn('[gateway-refresh] mode=reload result=fallback_restart cause=windows');
      logger.debug('Windows detected, falling back to Gateway restart for reload');
      await this.restart();
      return;
    }

    const connectedForMs = this.status.connectedAt
      ? Date.now() - this.status.connectedAt
      : Number.POSITIVE_INFINITY;

    // Avoid signaling a process that just came up; it will already read latest config.
    if (connectedForMs < 8000) {
      logger.info(
        `[gateway-refresh] mode=reload result=skipped_recent_connect connectedForMs=${connectedForMs} pid=${this.process.pid}`,
      );
      logger.info(`Gateway connected ${connectedForMs}ms ago, skipping reload signal`);
      return;
    }

    try {
      process.kill(this.process.pid, 'SIGUSR1');
      logger.info(`Sent SIGUSR1 to Gateway for config reload (pid=${this.process.pid})`);
      // Some gateway builds do not handle SIGUSR1 as an in-process reload.
      // If process state doesn't recover quickly, fall back to restart.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (this.status.state !== 'running' || !this.process?.pid) {
        logger.warn('[gateway-refresh] mode=reload result=fallback_restart cause=post_signal_unhealthy');
        logger.warn('Gateway did not stay running after reload signal, falling back to restart');
        await this.restart();
      } else {
        const pidAfter = this.process.pid;
        logger.info(
          `[gateway-refresh] mode=reload result=applied_in_place pidBefore=${pidBefore} pidAfter=${pidAfter}`,
        );
      }
    } catch (error) {
      logger.warn('[gateway-refresh] mode=reload result=fallback_restart cause=signal_error');
      logger.warn('Gateway reload signal failed, falling back to restart:', error);
      await this.restart();
    }
  }

  /**
   * Debounced reload — coalesces multiple rapid config-change events into one
   * in-process reload when possible.
   */
  debouncedReload(delayMs?: number): void {
    void this.refreshReloadPolicy();
    const effectiveDelay = delayMs ?? this.reloadPolicy.debounceMs;
    if (this.reloadPolicy.mode === 'off' || this.reloadPolicy.mode === 'restart') {
      logger.debug(
        `Gateway reload policy=${this.reloadPolicy.mode}; routing debouncedReload to debouncedRestart (${effectiveDelay}ms)`,
      );
      this.debouncedRestart(effectiveDelay);
      return;
    }

    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }
    logger.debug(`Gateway reload debounced (will fire in ${effectiveDelay}ms)`);
    this.reloadDebounceTimer = setTimeout(() => {
      this.reloadDebounceTimer = null;
      void this.reload().catch((err) => {
        logger.warn('Debounced Gateway reload failed:', err);
      });
    }, effectiveDelay);
  }

  private async refreshReloadPolicy(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.reloadPolicyLoadedAt < GatewayManager.RELOAD_POLICY_REFRESH_MS) {
      return;
    }

    if (this.reloadPolicyRefreshPromise) {
      await this.reloadPolicyRefreshPromise;
      return;
    }

    this.reloadPolicyRefreshPromise = (async () => {
      const nextPolicy = await loadGatewayReloadPolicy();
      this.reloadPolicy = nextPolicy;
      this.reloadPolicyLoadedAt = Date.now();
    })();

    try {
      await this.reloadPolicyRefreshPromise;
    } finally {
      this.reloadPolicyRefreshPromise = null;
    }
  }

  /**
   * Clear all active timers
   */
  private clearAllTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionMonitor.clear();
    this.restartController.clearDebounceTimer();
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
  }

  /**
   * Make an RPC call to the Gateway
   * Uses OpenClaw protocol format: { type: "req", id: "...", method: "...", params: {...} }
   */
  async rpc<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }

      const id = crypto.randomUUID();

      // Set timeout for request
      const timeout = setTimeout(() => {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`RPC timeout: ${method}`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send request using OpenClaw protocol format
      const request = {
        type: 'req',
        id,
        method,
        params,
      };

      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`Failed to send RPC request: ${error}`));
      }
    });
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    this.connectionMonitor.startHealthCheck({
      shouldCheck: () => this.status.state === 'running',
      checkHealth: () => this.checkHealth(),
      onUnhealthy: (errorMessage) => {
        this.emit('error', new Error(errorMessage));
      },
      onError: () => {
        // The monitor already logged the error; nothing else to do here.
      },
    });
  }

  /**
   * Check Gateway health via WebSocket ping
   * OpenClaw Gateway doesn't have an HTTP /health endpoint
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string; uptime?: number }> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const uptime = this.status.connectedAt
          ? Math.floor((Date.now() - this.status.connectedAt) / 1000)
          : undefined;
        return { ok: true, uptime };
      }
      return { ok: false, error: 'WebSocket not connected' };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  /**
   * Start Gateway process
   * Uses OpenClaw npm package from node_modules (dev) or resources (production)
   */
  private async startProcess(): Promise<void> {
    const launchContext = await prepareGatewayLaunchContext(this.status.port);
    await unloadLaunchctlGatewayService();
    this.processExitCode = null;

    const { child, lastSpawnSummary } = await launchGatewayProcess({
      port: this.status.port,
      launchContext,
      sanitizeSpawnArgs: (args) => this.sanitizeSpawnArgs(args),
      getCurrentState: () => this.status.state,
      getShouldReconnect: () => this.shouldReconnect,
      onStderrLine: (line) => {
        recordGatewayStartupStderrLine(this.recentStartupStderrLines, line);
        const classified = classifyGatewayStderrMessage(line);
        if (classified.level === 'drop') return;
        if (classified.level === 'debug') {
          logger.debug(`[Gateway stderr] ${classified.normalized}`);
          return;
        }
        logger.warn(`[Gateway stderr] ${classified.normalized}`);
      },
      onSpawn: (pid) => {
        this.setStatus({ pid });
      },
      onExit: (exitedChild, code) => {
        this.processExitCode = code;
        this.ownsProcess = false;
        this.connectionMonitor.clear();
        if (this.process === exitedChild) {
          this.process = null;
        }
        this.emit('exit', code);

        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      },
      onError: () => {
        this.ownsProcess = false;
        if (this.process === child) {
          this.process = null;
        }
      },
    });

    this.process = child;
    this.ownsProcess = true;
    logger.debug(`Gateway manager now owns process pid=${child.pid ?? 'unknown'}`);
    this.lastSpawnSummary = lastSpawnSummary;
  }

  /**
   * Connect WebSocket to Gateway
   */
  private async connect(port: number, _externalToken?: string): Promise<void> {
    this.ws = await connectGatewaySocket({
      port,
      deviceIdentity: this.deviceIdentity,
      platform: process.platform,
      pendingRequests: this.pendingRequests,
      getToken: async () => await import('../utils/store').then(({ getSetting }) => getSetting('gatewayToken')),
      onHandshakeComplete: (ws) => {
        this.ws = ws;
        ws.on('pong', () => {
          this.connectionMonitor.markAlive('pong');
        });
        this.setStatus({
          state: 'running',
          port,
          connectedAt: Date.now(),
        });
        this.startPing();
      },
      onMessage: (message) => {
        this.handleMessage(message);
      },
      onCloseAfterHandshake: () => {
        this.connectionMonitor.clear();
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      },
    });
  }

  /** Extract text from mixed message content structures. */
  private extractMessageText(content: unknown, depth = 0): string {
    if (depth > 3) return '';
    if (typeof content === 'string') return content;
    if (content == null) return '';
    if (Array.isArray(content)) {
      const parts = content
        .map((item) => this.extractMessageText(item, depth + 1))
        .filter(Boolean);
      return parts.join('\n');
    }
    if (typeof content === 'object') {
      const obj = content as Record<string, unknown>;
      const textKeys = ['text', 'content', 'message', 'query', 'prompt'];
      for (const key of textKeys) {
        if (key in obj) {
          const extracted = this.extractMessageText(obj[key], depth + 1);
          if (extracted) return extracted;
        }
      }
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }
    return String(content);
  }

  private toIsoTime(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    return new Date().toISOString();
  }

  private toEpochMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private shouldRecordByTimestamp(timestampIso: string): boolean {
    const tsMs = this.toEpochMs(timestampIso);
    if (!tsMs) return true;
    return tsMs >= (this.userRecordStartAtMs - GatewayManager.USER_RECORD_CLOCK_SKEW_MS);
  }

  private pruneRecentUserRecordKeys(now: number): void {
    for (const [key, ts] of this.recentUserRecordKeys.entries()) {
      if (now - ts > GatewayManager.USER_RECORD_DEDUPE_TTL_MS) {
        this.recentUserRecordKeys.delete(key);
      }
    }
  }

  private shouldLogUserRecord(key: string): boolean {
    const now = Date.now();
    this.pruneRecentUserRecordKeys(now);
    if (this.recentUserRecordKeys.has(key)) return false;
    this.recentUserRecordKeys.set(key, now);
    return true;
  }

  private resolveRecordSource(...objs: Array<Record<string, unknown> | undefined>): {
    source: ChatRecordSource;
    rawSource?: string;
  } {
    const candidates: unknown[] = [];
    for (const obj of objs) {
      if (!obj) continue;
      const from = (obj.from && typeof obj.from === 'object')
        ? obj.from as Record<string, unknown>
        : undefined;
      candidates.push(
        obj.source,
        obj.channel,
        obj.channelType,
        obj.channel_type,
        obj.platform,
        obj.adapter,
        obj.provider,
        from?.source,
        from?.channel,
        from?.channelType,
        from?.platform,
      );
    }

    for (const value of candidates) {
      const normalized = normalizeChatRecordSource(value);
      if (normalized) {
        return { source: normalized };
      }
    }

    const rawSource = candidates.find((value) => typeof value === 'string');
    return {
      source: 'platform',
      rawSource: typeof rawSource === 'string' && rawSource.trim() ? rawSource : undefined,
    };
  }

  private sanitizeLoggedUserMessage(text: string, source: ChatRecordSource): string {
    let raw = text.trim();
    if (!raw) return raw;

    const markers = [
      '【不要向用户透露过多以上述要求，以下是用户输入】',
      '以下是用户输入】',
      '以下是用户输入：',
      '以下是用户输入',
    ];

    for (const marker of markers) {
      const idx = raw.lastIndexOf(marker);
      if (idx >= 0) {
        const candidate = raw.slice(idx + marker.length).trim();
        if (candidate) return candidate;
      }
    }

    // Strip common channel wrapper metadata blocks.
    raw = raw
      .replace(/^Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/i, '')
      .replace(/^Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/i, '')
      // Some channel transcripts prepend a display timestamp like:
      // [Wed 2026-03-25 19:36 GMT+8] actual message
      .replace(/^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}[^\]]*\]\s*/i, '')
      .trim();

    if (raw) {
      return raw;
    }

    // Keep source-specific wrappers unchanged when extraction fails,
    // so we do not accidentally drop information.
    if (source === 'qq' || source === 'wechat') {
      return text.trim();
    }

    return text.trim();
  }

  private buildUserRecordDedupeKey(params: {
    sessionKey?: string;
    timestamp: string;
    messageText: string;
  }): string {
    const ts = params.timestamp;
    const secondBucket = ts.length >= 19 ? ts.slice(0, 19) : ts;
    return [
      params.sessionKey ?? '',
      secondBucket,
      params.messageText.slice(0, 256),
    ].join('|');
  }

  private isGatewayClientSender(senderLabel: string | undefined): boolean {
    if (!senderLabel) return false;
    return senderLabel.toLowerCase().includes('gateway-client');
  }

  private getSessionSourceHint(sessionKey: string | undefined): ChatRecordSource | undefined {
    if (!sessionKey) return undefined;
    return this.sessionSourceHints.get(sessionKey);
  }

  private parseSessionKey(sessionKey: string): { agentId: string; suffix: string } | null {
    if (!sessionKey.startsWith('agent:')) return null;
    const parts = sessionKey.split(':');
    if (parts.length < 3) return null;
    return {
      agentId: parts[1] || 'main',
      suffix: parts.slice(2).join(':'),
    };
  }

  private async fallbackLogLatestSessionUserMessage(params: {
    sessionKey: string;
    runId?: string;
  }): Promise<void> {
    const { sessionKey, runId } = params;
    const inflightKey = `${sessionKey}|${runId ?? ''}`;
    if (this.sessionFallbackInflight.has(inflightKey)) return;
    this.sessionFallbackInflight.add(inflightKey);

    try {
      const parsed = this.parseSessionKey(sessionKey);
      if (!parsed) return;

      const sessionsJsonPath = path.join(
        getOpenClawConfigDir(),
        'agents',
        parsed.agentId,
        'sessions',
        'sessions.json',
      );
      const sessionsRaw = await readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(sessionsRaw) as Record<string, unknown>;
      const entry = sessionsJson[sessionKey];
      if (!entry || typeof entry !== 'object') return;
      const entryObj = entry as Record<string, unknown>;

      const source = this.inferSourceFromObject(entryObj) ?? this.getSessionSourceHint(sessionKey);
      if (!source || source === 'platform') return;

      const sessionFileRaw = entryObj.sessionFile;
      const sessionFile = typeof sessionFileRaw === 'string' && sessionFileRaw.trim()
        ? sessionFileRaw
        : path.join(
          getOpenClawConfigDir(),
          'agents',
          parsed.agentId,
          'sessions',
          `${parsed.suffix}.jsonl`,
        );
      const jsonlRaw = await readFile(sessionFile, 'utf8');
      const lines = jsonlRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (!line) continue;
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof record !== 'object' || record === null) continue;
        const rec = record as Record<string, unknown>;
        if (rec.type !== 'message' || typeof rec.message !== 'object' || rec.message == null) continue;
        const msg = rec.message as Record<string, unknown>;
        const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
        if (role !== 'user') continue;
        const senderLabel = typeof msg.senderLabel === 'string' ? msg.senderLabel : undefined;
        if (this.isGatewayClientSender(senderLabel)) {
          // Desktop-originated messages are already logged via renderer -> IPC;
          // skip gateway replay path to avoid duplicate records.
          return;
        }
        const text = this.extractMessageText(msg.content);
        if (!text.trim()) return;
        const cleanedText = this.sanitizeLoggedUserMessage(text, source) || text;
        const timestamp = this.toIsoTime(msg.timestamp ?? rec.timestamp);
        if (!this.shouldRecordByTimestamp(timestamp)) {
          return;
        }
        const dedupeKey = this.buildUserRecordDedupeKey({
          sessionKey,
          timestamp,
          messageText: cleanedText,
        });
        if (!this.shouldLogUserRecord(dedupeKey)) return;
        writeChatRecord({
          timestamp,
          type: resolveChatRecordTypeBySource(source),
          source,
          sessionKey,
          agentId: parsed.agentId,
          runId,
          messageText: cleanedText,
          extra: 'fallback=session-jsonl',
        });
        return;
      }
    } catch {
      // Fallback logging failure should never affect chat flow.
    } finally {
      this.sessionFallbackInflight.delete(inflightKey);
    }
  }

  private inferSourceFromObject(obj: Record<string, unknown>): ChatRecordSource | null {
    const origin = (obj.origin && typeof obj.origin === 'object')
      ? obj.origin as Record<string, unknown>
      : undefined;
    const deliveryContext = (obj.deliveryContext && typeof obj.deliveryContext === 'object')
      ? obj.deliveryContext as Record<string, unknown>
      : undefined;
    const candidates: unknown[] = [
      obj.source,
      obj.channel,
      obj.channelType,
      obj.channel_type,
      obj.lastChannel,
      obj.provider,
      obj.surface,
      origin?.provider,
      origin?.surface,
      deliveryContext?.channel,
    ];
    for (const value of candidates) {
      const normalized = normalizeChatRecordSource(value);
      if (normalized) return normalized;
    }
    const displayName = typeof obj.displayName === 'string' ? obj.displayName.toLowerCase() : '';
    if (displayName.startsWith('qqbot:')) return 'qq';
    if (displayName.includes('@im.wechat')) return 'wechat';
    return null;
  }

  private ingestSessionSourceHints(node: unknown, depth = 0): void {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        this.ingestSessionSourceHints(item, depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const sessionKey = typeof obj.sessionKey === 'string'
      ? obj.sessionKey
      : (typeof obj.key === 'string' ? obj.key : null);
    if (sessionKey) {
      const source = this.inferSourceFromObject(obj);
      if (source) {
        this.sessionSourceHints.set(sessionKey, source);
      }
    }
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        this.ingestSessionSourceHints(value, depth + 1);
      }
    }
  }

  private extractUserCandidates(
    node: unknown,
    ancestors: Record<string, unknown>[] = [],
    out: Array<{
      timestamp: string;
      source: ChatRecordSource;
      rawSource?: string;
      sessionKey?: string;
      agentId?: string;
      runId?: string;
      messageText: string;
      extra?: string;
    }> = [],
    depth = 0,
  ): Array<{
    timestamp: string;
    source: ChatRecordSource;
    rawSource?: string;
    sessionKey?: string;
    agentId?: string;
    runId?: string;
    messageText: string;
    extra?: string;
  }> {
    if (depth > 8 || node == null) return out;
    if (Array.isArray(node)) {
      for (const item of node) {
        this.extractUserCandidates(item, ancestors, out, depth + 1);
      }
      return out;
    }
    if (typeof node !== 'object') return out;

    const obj = node as Record<string, unknown>;
    const role = typeof obj.role === 'string' ? obj.role.toLowerCase() : '';
    if (role === 'user') {
      const text = this.extractMessageText(obj.content);
      if (text.trim()) {
        const contexts = [obj, ...ancestors];
        const sourceResolved = this.resolveRecordSource(...contexts);
        const sessionCtx = contexts.find((ctx) => ctx.sessionKey != null);
        const runCtx = contexts.find((ctx) => ctx.runId != null);
        const agentCtx = contexts.find((ctx) => ctx.agentId != null);
        const tsCtx = contexts.find((ctx) => ctx.timestamp != null || ctx.ts != null);
        const eventCtx = contexts.find((ctx) => ctx.event != null || ctx.method != null || ctx.stream != null);
        const senderLabel = typeof obj.senderLabel === 'string' ? obj.senderLabel : undefined;
        if (this.isGatewayClientSender(senderLabel)) {
          // Desktop-originated messages are logged by the renderer path.
          // Skipping them here prevents platform + channel duplicate lines.
          return out;
        }
        const sessionKey = sessionCtx?.sessionKey != null ? String(sessionCtx.sessionKey) : undefined;
        const hintedSource = sessionKey ? this.sessionSourceHints.get(sessionKey) : undefined;
        const source = sourceResolved.source === 'platform' && hintedSource
          ? hintedSource
          : sourceResolved.source;
        const rawSource = source === sourceResolved.source ? sourceResolved.rawSource : 'sessionHint';

        const cleanedText = this.sanitizeLoggedUserMessage(text, source) || text;
        out.push({
          timestamp: this.toIsoTime(obj.timestamp ?? tsCtx?.timestamp ?? tsCtx?.ts),
          source,
          rawSource,
          sessionKey,
          runId: runCtx?.runId != null ? String(runCtx.runId) : undefined,
          agentId: agentCtx?.agentId != null ? String(agentCtx.agentId) : undefined,
          messageText: cleanedText,
          extra: [
            eventCtx?.event != null ? `event=${String(eventCtx.event)}` : null,
            eventCtx?.method != null ? `method=${String(eventCtx.method)}` : null,
            eventCtx?.stream != null ? `stream=${String(eventCtx.stream)}` : null,
            senderLabel ? `sender=${senderLabel}` : null,
            rawSource ? `rawSource=${rawSource}` : null,
          ].filter(Boolean).join(','),
        });
      }
    }

    const nextAncestors = [obj, ...ancestors].slice(0, 6);
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        this.extractUserCandidates(value, nextAncestors, out, depth + 1);
      }
    }
    return out;
  }

  private logUserRoleMessage(message: unknown): void {
    const candidates = this.extractUserCandidates(message);
    for (const c of candidates) {
      if (!this.shouldRecordByTimestamp(c.timestamp)) {
        continue;
      }
      const dedupeKey = this.buildUserRecordDedupeKey({
        sessionKey: c.sessionKey,
        timestamp: c.timestamp,
        messageText: c.messageText,
      });
      if (!this.shouldLogUserRecord(dedupeKey)) {
        continue;
      }
      writeChatRecord({
        timestamp: c.timestamp,
        type: resolveChatRecordTypeBySource(c.source),
        source: c.source,
        sessionKey: c.sessionKey,
        agentId: c.agentId,
        runId: c.runId,
        messageText: c.messageText,
        extra: c.extra,
      });
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: unknown): void {
    this.connectionMonitor.markAlive('message');

    // Raw traffic capture for channel payload debugging.
    writeGatewayRawMessage(message);

    // Keep an in-memory mapping of sessionKey -> channel source (qq/wechat/...).
    this.ingestSessionSourceHints(message);

    // ── postChatRecord: intercept user-role messages from all sources ──
    this.logUserRoleMessage(message);

    if (typeof message !== 'object' || message === null) {
      logger.debug('Received non-object Gateway message');
      return;
    }

    const msg = message as Record<string, unknown>;

    if (msg.type === 'event' && msg.event === 'agent' && typeof msg.payload === 'object' && msg.payload !== null) {
      const payload = msg.payload as Record<string, unknown>;
      const stream = typeof payload.stream === 'string' ? payload.stream : '';
      const data = (payload.data && typeof payload.data === 'object')
        ? payload.data as Record<string, unknown>
        : undefined;
      const phase = typeof data?.phase === 'string' ? data.phase : '';
      const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : '';
      const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
      // QQ inbound user turns are not always present in realtime WS events.
      // On lifecycle start, read latest user turn from the authoritative session jsonl.
      if (stream === 'lifecycle' && phase === 'start' && sessionKey) {
        void this.fallbackLogLatestSessionUserMessage({ sessionKey, runId });
      }
    }

    // Handle OpenClaw protocol response format: { type: "res", id: "...", ok: true/false, ... }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      if (msg.ok === false || msg.error) {
        const errorObj = msg.error as { message?: string; code?: number } | undefined;
        const errorMsg = errorObj?.message || JSON.stringify(msg.error) || 'Unknown error';
        if (rejectPendingGatewayRequest(this.pendingRequests, msg.id, new Error(errorMsg))) {
          return;
        }
      } else if (resolvePendingGatewayRequest(this.pendingRequests, msg.id, msg.payload ?? msg)) {
        return;
      }
    }

    // Handle OpenClaw protocol event format: { type: "event", event: "...", payload: {...} }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      dispatchProtocolEvent(this, msg.event, msg.payload);
      return;
    }

    // Fallback: Check if this is a JSON-RPC 2.0 response (legacy support)
    if (isResponse(message) && message.id && this.pendingRequests.has(String(message.id))) {
      if (message.error) {
        const errorMsg = typeof message.error === 'object'
          ? (message.error as { message?: string }).message || JSON.stringify(message.error)
          : String(message.error);
        rejectPendingGatewayRequest(this.pendingRequests, String(message.id), new Error(errorMsg));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, String(message.id), message.result);
      }
      return;
    }

    // Check if this is a JSON-RPC notification (server-initiated event)
    if (isNotification(message)) {
      dispatchJsonRpcNotification(this, message);
      return;
    }

    this.emit('message', message);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.connectionMonitor.startPing({
      intervalMs: GatewayManager.HEARTBEAT_INTERVAL_MS,
      timeoutMs: GatewayManager.HEARTBEAT_TIMEOUT_MS,
      maxConsecutiveMisses: GatewayManager.HEARTBEAT_MAX_MISSES,
      sendPing: () => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      },
      onHeartbeatTimeout: ({ consecutiveMisses, timeoutMs }) => {
        if (this.status.state !== 'running' || !this.shouldReconnect) {
          return;
        }
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        logger.warn(
          `Gateway heartbeat timed out after ${consecutiveMisses} consecutive misses (timeout=${timeoutMs}ms); terminating stale socket`,
        );
        try {
          ws.terminate();
        } catch (error) {
          logger.warn('Failed to terminate stale Gateway socket after heartbeat timeout:', error);
        }
      },
    });
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    const decision = getReconnectScheduleDecision({
      shouldReconnect: this.shouldReconnect,
      hasReconnectTimer: this.reconnectTimer !== null,
      reconnectAttempts: this.reconnectAttempts,
      maxAttempts: this.reconnectConfig.maxAttempts,
      baseDelay: this.reconnectConfig.baseDelay,
      maxDelay: this.reconnectConfig.maxDelay,
    });

    if (decision.action === 'skip') {
      logger.debug(`Gateway reconnect skipped (${decision.reason})`);
      return;
    }

    if (decision.action === 'already-scheduled') {
      return;
    }

    if (decision.action === 'fail') {
      logger.error(`Gateway reconnect failed: max attempts reached (${decision.maxAttempts})`);
      this.setStatus({
        state: 'error',
        error: 'Failed to reconnect after maximum attempts',
        reconnectAttempts: this.reconnectAttempts
      });
      return;
    }

    const cooldownRemaining = Math.max(0, GatewayManager.RESTART_COOLDOWN_MS - (Date.now() - this.lastRestartAt));
    const { delay, nextAttempt, maxAttempts } = decision;
    const effectiveDelay = Math.max(delay, cooldownRemaining);
    this.reconnectAttempts = nextAttempt;
    logger.warn(`Scheduling Gateway reconnect attempt ${nextAttempt}/${maxAttempts} in ${effectiveDelay}ms`);

    this.setStatus({
      state: 'reconnecting',
      reconnectAttempts: this.reconnectAttempts
    });
    const scheduledEpoch = this.lifecycleController.getCurrentEpoch();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const skipReason = getReconnectSkipReason({
        scheduledEpoch,
        currentEpoch: this.lifecycleController.getCurrentEpoch(),
        shouldReconnect: this.shouldReconnect,
      });
      if (skipReason) {
        logger.debug(`Skipping reconnect attempt: ${skipReason}`);
        return;
      }
      const attemptNo = this.reconnectAttempts;
      this.reconnectAttemptsTotal += 1;
      try {
        // Use the guarded start() flow so reconnect attempts cannot bypass
        // lifecycle locking and accidentally start duplicate Gateway processes.
        await this.start();
        this.reconnectSuccessTotal += 1;
        this.emitReconnectMetric('success', {
          attemptNo,
          maxAttempts,
          delayMs: effectiveDelay,
        });
        this.reconnectAttempts = 0;
      } catch (error) {
        logger.error('Gateway reconnection attempt failed:', error);
        this.emitReconnectMetric('failure', {
          attemptNo,
          maxAttempts,
          delayMs: effectiveDelay,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect();
      }
    }, effectiveDelay);
  }

  private emitReconnectMetric(
    outcome: 'success' | 'failure',
    payload: {
      attemptNo: number;
      maxAttempts: number;
      delayMs: number;
      error?: string;
    },
  ): void {
    const successRate = this.reconnectAttemptsTotal > 0
      ? this.reconnectSuccessTotal / this.reconnectAttemptsTotal
      : 0;

    const properties = {
      outcome,
      attemptNo: payload.attemptNo,
      maxAttempts: payload.maxAttempts,
      delayMs: payload.delayMs,
      gateway_reconnect_success_count: this.reconnectSuccessTotal,
      gateway_reconnect_attempt_count: this.reconnectAttemptsTotal,
      gateway_reconnect_success_rate: Number(successRate.toFixed(4)),
      ...(payload.error ? { error: payload.error } : {}),
    };

    trackMetric('gateway.reconnect', properties);
    // Keep local metrics only; do not upload reconnect details to PostHog.
  }

  /**
   * Update status and emit event
   */
  private setStatus(update: Partial<GatewayStatus>): void {
    this.stateController.setStatus(update);
  }
}
