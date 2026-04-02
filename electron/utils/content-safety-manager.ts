/**
 * ContentSafetyManager
 *
 * Manages the content-safety utilityProcess worker.
 * Provides an async `check(text)` method that routes calls to the worker
 * and keeps the main process event loop free during CPU-intensive matching.
 */

import { app, utilityProcess } from 'electron';
import { join } from 'path';
import { logger } from './logger';
import { getResourcesDir } from './paths';

export interface ContentSafetyResult {
  pass: boolean;
  reason?: string;
}

type PendingResolve = (result: ContentSafetyResult) => void;

const REQUEST_TIMEOUT_MS = 5000;

class ContentSafetyManager {
  private worker: Electron.UtilityProcess | null = null;
  private pending = new Map<string, { resolve: PendingResolve; timer: ReturnType<typeof setTimeout> }>();
  private idSeq = 0;
  private workerReady = false;
  private startPromise: Promise<void> | null = null;

  /** Start the worker process. Called once at app startup. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._doStart();
    return this.startPromise;
  }

  private _doStart(): Promise<void> {
    return new Promise<void>((resolve) => {
      const workerPath = app.isPackaged
        ? join(process.resourcesPath, 'app.asar', 'dist-electron', 'utils', 'content-safety-worker.js')
        : join(__dirname, '../utils/content-safety-worker.js');

      const fuzzyKeywordsPath = join(getResourcesDir(), 'content-safety', 'fuzzy-keywords.txt');
      const hardKeywordsPath = join(getResourcesDir(), 'content-safety', 'hard-keywords.txt');

      logger.info(`[ContentSafety] Starting worker from: ${workerPath}`);

      this.worker = utilityProcess.fork(workerPath, [], {
        serviceName: 'ContentSafetyWorker',
        stdio: 'pipe',
      });

      this.worker.stderr?.on('data', (data: Buffer) => {
        logger.warn(`[ContentSafety] worker stderr: ${data.toString().trim()}`);
      });

      this.worker.on('exit', (code: number) => {
        logger.warn(`[ContentSafety] worker exited (code=${code})`);
        this.workerReady = false;
        this.worker = null;
        // Resolve any remaining pending requests with pass=true to avoid hanging callers
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.resolve({ pass: true });
        }
        this.pending.clear();
      });

      this.worker.on('message', (data: Record<string, unknown>) => {
        if (data.type === 'ready') {
          this.workerReady = true;
          logger.info(
            `[ContentSafety] worker ready (fuzzy=${data.fuzzyCount}, hard=${data.hardCount})`,
          );
          resolve();
          return;
        }

        if (data.type === 'error') {
          logger.error(`[ContentSafety] worker init error: ${data.message}`);
          resolve(); // still resolve so startup doesn't hang; checks will pass-through
          return;
        }

        if (data.type === 'result') {
          const id = data.id as string;
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.resolve({ pass: data.pass as boolean, reason: data.reason as string | undefined });
          }
        }
      });

      // Send init message with keyword file paths
      this.worker.postMessage({
        type: 'init',
        fuzzyKeywordsPath,
        hardKeywordsPath,
      });
    });
  }

  /**
   * Check whether `text` passes content safety.
   * Always resolves (never rejects); returns { pass: true } on any internal error.
   */
  async check(text: string): Promise<ContentSafetyResult> {
    if (!text) return { pass: true };

    // If worker is not running, pass through (fail-open to avoid blocking users)
    if (!this.worker || !this.workerReady) {
      logger.warn('[ContentSafety] worker not ready, skipping check');
      return { pass: true };
    }

    const id = String(this.idSeq++);

    return new Promise<ContentSafetyResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          logger.warn(`[ContentSafety] check timed out for id=${id}`);
          resolve({ pass: true }); // fail-open on timeout
        }
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
      this.worker!.postMessage({ type: 'check', id, text });
    });
  }

  /** Terminate the worker gracefully. */
  stop(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
      this.workerReady = false;
    }
  }
}

export const contentSafetyManager = new ContentSafetyManager();
