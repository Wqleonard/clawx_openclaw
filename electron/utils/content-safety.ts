/**
 * Content safety public API.
 *
 * Delegates to ContentSafetyManager which runs matching in a
 * dedicated utilityProcess to avoid blocking the main process.
 */

export type { ContentSafetyResult } from './content-safety-manager';
export { contentSafetyManager } from './content-safety-manager';

import { contentSafetyManager } from './content-safety-manager';
import type { ContentSafetyResult } from './content-safety-manager';

/**
 * Asynchronously check whether `text` passes content safety rules.
 * Returns { pass: true } when safe; { pass: false, reason } when blocked.
 */
export async function checkContentSafety(text: string): Promise<ContentSafetyResult> {
  return contentSafetyManager.check(text);
}
