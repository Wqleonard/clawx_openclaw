/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 *
 * Update providers are configured in electron-builder.yml (OSS primary, GitHub fallback).
 * For prerelease channels (alpha, beta), the feed URL is overridden at runtime
 * to point at the channel-specific OSS directory (e.g. /alpha/, /beta/).
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { BrowserWindow, app, ipcMain } from 'electron';
import { execSync, spawn } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { setQuitting } from './app-state';

/** Base CDN URL (without trailing channel path) */
// const OSS_BASE_URL = 'https://oss.intelli-spectrum.com';
const UPDATE_BASE_URL = 'https://story-claw.tos-cn-beijing.volces.com';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'needs-reinstall';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export interface UpdaterEvents {
  'status-changed': (status: UpdateStatus) => void;
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfo) => void;
  'update-not-available': (info: UpdateInfo) => void;
  'download-progress': (progress: ProgressInfo) => void;
  'update-downloaded': (event: UpdateDownloadedEvent) => void;
  'error': (error: Error) => void;
}

/**
 * Detect the update channel from a semver version string.
 * e.g. "0.1.8-alpha.0" → "alpha", "1.0.0-beta.1" → "beta", "1.0.0" → "latest"
 */
function detectChannel(version: string): string {
  const match = version.match(/-([a-zA-Z]+)/);
  return match ? match[1] : 'latest';
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private autoInstallTimer: NodeJS.Timeout | null = null;
  private autoInstallCountdown = 0;

  /** Delay (in seconds) before auto-installing a downloaded update. */
  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  /**
   * Check if an error message indicates network or yml is unreachable.
   * These errors should be silently treated as "no update available".
   */
  private static isNetworkOrYmlError(msg: string): boolean {
    return /net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|404|sha512|checksum|HttpError/i.test(msg);
  }

  /**
   * Check if an error is a code signature validation failure.
   * This happens when updating from an adhoc-signed build.
   */
  private static isSignatureError(msg: string): boolean {
    return /code signature|did not pass validation|代码未能满足|ShipIt/i.test(msg);
  }

  constructor() {
    super();

    // EventEmitter treats an unhandled 'error' event as fatal. Keep a default
    // listener so updater failures surface in logs/UI without terminating main.
    this.on('error', (error: Error) => {
      logger.error('[Updater] AppUpdater emitted error:', error);
    });
    
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Differential download can fall back to full download when blockmap
    // does not match the final signed installer, causing double traffic.
    // We disable it to keep update behavior deterministic.
    (autoUpdater as typeof autoUpdater & { disableDifferentialDownload?: boolean }).disableDifferentialDownload = true;
    
    autoUpdater.logger = {
      info: (msg: string) => logger.info('[Updater]', msg),
      warn: (msg: string) => logger.warn('[Updater]', msg),
      error: (msg: string) => logger.error('[Updater]', msg),
      debug: (msg: string) => logger.debug('[Updater]', msg),
    };

    // Override feed URL for prerelease channels so that
    // alpha -> /alpha/alpha-mac.yml, beta -> /beta/beta-mac.yml, etc.
    const version = app.getVersion();
    const channel = detectChannel(version);
    const feedUrl = `${UPDATE_BASE_URL}/${channel}`;

    logger.info(`[Updater] Version: ${version}, channel: ${channel}, feedUrl: ${feedUrl}`);
    logger.info('[Updater] Differential download disabled');

    // Set channel so electron-updater requests the correct yml filename.
    // e.g. channel "alpha" → requests alpha-mac.yml, channel "latest" → requests latest-mac.yml
    autoUpdater.channel = channel;

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
      useMultipleRangeRequest: false,
    });

    this.setupListeners();
  }

  /**
   * Set the main window for sending update events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get current update status
   */
  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * Setup auto-updater event listeners
   */
  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      logger.info('[Updater] checking-for-update');
      this.updateStatus({ status: 'checking' });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('[Updater] update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
      this.updateStatus({ status: 'available', info });
      this.emit('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info('[Updater] update-not-available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
      this.updateStatus({ status: 'not-available', info });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      logger.debug('[Updater] download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      logger.info('[Updater] update-downloaded', {
        version: event.version,
        releaseDate: event.releaseDate,
      });

      // Log current app's designated requirement so we can diagnose ShipIt failures
      try {
        const appPath = app.getAppPath().replace('/Contents/Resources/app.asar', '');
        const req = execSync(`codesign -d --requirements - "${appPath}" 2>&1`).toString().trim();
        logger.info('[Updater] installed app designated requirement:', req);
      } catch (e) {
        logger.warn('[Updater] could not read app requirements:', String(e));
      }

      this.updateStatus({ status: 'downloaded', info: event });
      this.emit('update-downloaded', event);

      if (autoUpdater.autoDownload) {
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      if (AppUpdater.isNetworkOrYmlError(error.message)) {
        logger.info('[Updater] Update check silenced (network/yml unreachable):', error.message);
        this.updateStatus({ status: 'not-available' });
      } else if (AppUpdater.isSignatureError(error.message)) {
        logger.warn('[Updater] Code signature validation failed, manual reinstall required:', error.message);
        // Preserve info so the renderer knows which version to download manually
        this.updateStatus({ status: 'needs-reinstall', info: this.status.info });
      } else {
        this.updateStatus({ status: 'error', error: error.message });
        this.emit('error', error);
      }
    });
  }

  /**
   * Update status and notify renderer
   */
  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = {
      status: newStatus.status ?? this.status.status,
      // Preserve existing info if not explicitly provided
      info: newStatus.info !== undefined ? newStatus.info : this.status.info,
      progress: newStatus.progress,
      error: newStatus.error,
    };
    this.sendToRenderer('update:status-changed', this.status);
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates.
   * electron-updater automatically tries providers defined in electron-builder.yml in order.
   *
   * In dev mode (not packed), autoUpdater.checkForUpdates() silently returns
   * null without emitting any events, so we must detect this and force a
   * final status so the UI never gets stuck in 'checking'.
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      logger.info('[Updater] checkForUpdates called');
      const result = await autoUpdater.checkForUpdates();

      // In dev mode (app not packaged), autoUpdater silently returns null
      // without emitting ANY events (not even checking-for-update).
      // Detect this and force an error so the UI never stays silent.
      if (result == null) {
        this.updateStatus({
          status: 'error',
          error: 'Update check skipped (dev mode – app is not packaged)',
        });
        return null;
      }

      // Safety net: if events somehow didn't fire, force a final state.
      if (this.status.status === 'checking' || this.status.status === 'idle') {
        this.updateStatus({ status: 'not-available' });
      }

      return result.updateInfo || null;
    } catch (error) {
      logger.error('[Updater] Check for updates failed:', error);
      const errMsg = (error as Error).message || String(error);
      if (AppUpdater.isNetworkOrYmlError(errMsg)) {
        this.updateStatus({ status: 'not-available' });
      } else {
        this.updateStatus({ status: 'error', error: errMsg });
        throw error;
      }
      return null;
    }
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      logger.info('[Updater] downloadUpdate called');
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  /**
   * Install update and restart.
   *
   * On macOS, electron-updater delegates to Squirrel.Mac (ShipIt). The
   * native quitAndInstall() spawns ShipIt then internally calls app.quit().
   * However, the tray close handler in index.ts intercepts window close
   * and hides to tray unless isQuitting is true. Squirrel's internal quit
   * sometimes fails to trigger before-quit in time, so we set isQuitting
   * BEFORE calling quitAndInstall(). This lets the native quit flow close
   * the window cleanly while ShipIt runs independently to replace the app.
   */
  quitAndInstall(): void {
    logger.info('[Updater] quitAndInstall called');

    // On macOS, bypass ShipIt (Squirrel.Mac) to avoid code signature
    // validation failures when using adhoc signing without a Developer ID.
    // On Windows, NsisUpdater handles install directly (verifyUpdateCodeSignature: false).
    if (process.platform === 'darwin') {
      const pendingDir = join(app.getPath('home'), 'Library', 'Caches', 'storyclaw-updater', 'pending');
      const version = this.status.info?.version;
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const zipName = version ? `StoryClaw-${version}-mac-${arch}.zip` : null;
      const zipPath = zipName ? join(pendingDir, zipName) : null;
      const appInstallPath = dirname(dirname(dirname(app.getAppPath())));

      if (zipPath && existsSync(zipPath) && appInstallPath.endsWith('.app')) {
        logger.info(`[Updater] Bypassing ShipIt — direct install from ${zipPath} to ${appInstallPath}`);

        const parentDir = dirname(appInstallPath);
        const script = [
          '#!/bin/sh',
          `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
          `rm -rf "${appInstallPath}"`,
          `unzip -q -o "${zipPath}" -d "${parentDir}"`,
          `open "${appInstallPath}"`,
        ].join('\n');

        const scriptPath = join(app.getPath('temp'), 'storyclaw-update.sh');
        writeFileSync(scriptPath, script, { mode: 0o755 });

        // Hide all windows immediately so user sees app disappear right away
        for (const win of BrowserWindow.getAllWindows()) {
          win.hide();
        }

        // Launch update script detached — does not block
        spawn('sh', [scriptPath], { detached: true, stdio: 'ignore' }).unref();

        logger.info('[Updater] Update script launched, quitting app');
        setQuitting();
        // Small delay so the hide animation completes before quit
        setTimeout(() => app.quit(), 300);
        return;
      }

      logger.warn(`[Updater] zip not found at ${zipPath ?? 'unknown'}, falling back to Squirrel`);
    }

    // Hide all windows immediately before quit so user sees app disappear right away
    for (const win of BrowserWindow.getAllWindows()) {
      win.hide();
    }

    setQuitting();
    autoUpdater.quitAndInstall();
  }

  /**
   * Start a countdown that auto-installs the downloaded update.
   * Sends `update:auto-install-countdown` events to the renderer each second.
   */
  private startAutoInstallCountdown(): void {
    this.clearAutoInstallTimer();
    this.autoInstallCountdown = AppUpdater.AUTO_INSTALL_DELAY_SECONDS;
    this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

    this.autoInstallTimer = setInterval(() => {
      this.autoInstallCountdown--;
      this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

      if (this.autoInstallCountdown <= 0) {
        this.clearAutoInstallTimer();
        this.quitAndInstall();
      }
    }, 1000);
  }

  cancelAutoInstall(): void {
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
    }
  }

  /**
   * Set update channel (stable, beta, dev)
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    autoUpdater.channel = channel;
  }

  /**
   * Set auto-download preference
   */
  setAutoDownload(enable: boolean): void {
    autoUpdater.autoDownload = enable;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }
}

/**
 * Register IPC handlers for update operations
 */
export function registerUpdateHandlers(
  updater: AppUpdater,
  mainWindow: BrowserWindow
): void {
  updater.setMainWindow(mainWindow);

  // Get current update status
  ipcMain.handle('update:status', () => {
    return updater.getStatus();
  });

  // Get current version
  ipcMain.handle('update:version', () => {
    return updater.getCurrentVersion();
  });

  // Check for updates – always return final status so the renderer
  // never gets stuck in 'checking' waiting for a push event.
  ipcMain.handle('update:check', async () => {
    try {
      await updater.checkForUpdates();
      return { success: true, status: updater.getStatus() };
    } catch (error) {
      return { success: false, error: String(error), status: updater.getStatus() };
    }
  });

  // Download update
  ipcMain.handle('update:download', async () => {
    try {
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install update and restart
  ipcMain.handle('update:install', () => {
    updater.quitAndInstall();
    return { success: true };
  });

  // Set update channel
  ipcMain.handle('update:setChannel', (_, channel: 'stable' | 'beta' | 'dev') => {
    updater.setChannel(channel);
    return { success: true };
  });

  // Set auto-download preference
  ipcMain.handle('update:setAutoDownload', (_, enable: boolean) => {
    updater.setAutoDownload(enable);
    return { success: true };
  });

  // Cancel pending auto-install countdown
  ipcMain.handle('update:cancelAutoInstall', () => {
    updater.cancelAutoInstall();
    return { success: true };
  });

  // Get manual download URL for the current platform/arch
  ipcMain.handle('update:getManualDownloadUrl', () => {
    // Use the pending update version if available, otherwise fall back to current
    const pendingVersion = updater.getStatus().info?.version;
    const version = pendingVersion ?? app.getVersion();
    const channel = detectChannel(version);
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const platform = process.platform;
    let filename: string;
    if (platform === 'darwin') {
      filename = `StoryClaw-${version}-mac-${arch}.dmg`;
    } else if (platform === 'win32') {
      filename = `StoryClaw-${version}-win-${arch}.exe`;
    } else {
      filename = `StoryClaw-${version}-linux-${arch}.AppImage`;
    }
    const url = `${UPDATE_BASE_URL}/${channel}/${filename}`;
    logger.info(`[Updater] manual download URL: ${url} (version=${version})`);
    return url;
  });

}

// Export singleton instance
export const appUpdater = new AppUpdater();
