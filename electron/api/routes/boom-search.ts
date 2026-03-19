/**
 * BoomClaw Web Search + Web Fetch API Routes
 *
 * /api/boom-search?q=...&count=...   → called by plugin's web_search tool
 * /api/boom-fetch?url=...&mode=...   → called by plugin's web_fetch tool
 *
 * Both are proxied through BoomClaw's host API so the Gateway process never
 * makes outbound HTTP calls subject to OpenClaw's SSRF restrictions.
 *
 * Replace the mock implementations with your real API calls.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { setCorsHeaders, sendJson } from '../route-utils';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface FetchResponse {
  url: string;
  content: string;
  extractMode: string;
}

// ── Mock implementations (replace with real APIs) ──────────────────────────

/**
 * TODO: Replace with real search API call.
 */
async function performSearch(query: string, _count: number): Promise<SearchResponse> {
  return {
    query,
    results: [
      {
        title: '仙人掌 - 维基百科',
        url: 'https://zh.wikipedia.org/wiki/%E4%BB%99%E4%BA%BA%E6%8E%8C',
        description: '仙人掌是沙漠中常见的植物',
      },
    ],
  };
}

/**
 * TODO: Replace with real fetch/scrape API call.
 */
async function performFetch(
  targetUrl: string,
  _mode: string,
  _maxChars: number,
): Promise<FetchResponse> {
  return {
    url: targetUrl,
    content: '仙人掌是沙漠中常见的植物，耐旱性极强，能在极端干旱的环境下存活。',
    extractMode: _mode,
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function handleBoomSearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const { pathname } = url;

  if (pathname !== '/api/boom-search' && pathname !== '/api/boom-fetch') {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  // ── /api/boom-search ────────────────────────────────────────────
  if (pathname === '/api/boom-search') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    if (!query) {
      sendJson(res, 400, { error: 'Missing query parameter "q"' });
      return true;
    }
    const count = Math.min(10, Math.max(1, parseInt(url.searchParams.get('count') ?? '5', 10) || 5));
    try {
      sendJson(res, 200, await performSearch(query, count));
    } catch (err) {
      sendJson(res, 500, { error: 'Search failed', message: String(err) });
    }
    return true;
  }

  // ── /api/boom-fetch ─────────────────────────────────────────────
  if (pathname === '/api/boom-fetch') {
    const targetUrl = url.searchParams.get('url')?.trim() ?? '';
    if (!targetUrl) {
      sendJson(res, 400, { error: 'Missing query parameter "url"' });
      return true;
    }
    const mode = url.searchParams.get('mode') ?? 'markdown';
    const maxChars = Math.min(
      200000,
      Math.max(1000, parseInt(url.searchParams.get('maxChars') ?? '50000', 10) || 50000),
    );
    try {
      sendJson(res, 200, await performFetch(targetUrl, mode, maxChars));
    } catch (err) {
      sendJson(res, 500, { error: 'Fetch failed', message: String(err) });
    }
    return true;
  }

  return false;
}
