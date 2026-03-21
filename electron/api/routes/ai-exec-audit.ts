import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson, setCorsHeaders } from '../route-utils';
import { getProviderSecret } from '../../services/secrets/secret-store';
import { getClawXProviderStore } from '../../services/providers/store-instance';
import { logger } from '../../utils/logger';

type AuditDecision = 'ALLOW' | 'BLOCK';

interface AuditRequestBody {
  command?: string;
  toolName?: string;
  sessionId?: string;
  callId?: string;
  cwd?: string;
}

interface AuditResponseBody {
  decision: AuditDecision;
}

interface ResponsesApiAnnotation {
  type: string;
  url?: string;
  title?: string;
}

interface ResponsesApiContentBlock {
  type: string;
  text?: string;
  annotations?: ResponsesApiAnnotation[];
}

interface ResponsesApiOutputItem {
  type: string;
  role?: string;
  content?: ResponsesApiContentBlock[];
}

interface ResponsesApiResponse {
  output?: ResponsesApiOutputItem[];
}

const AUDIT_ACCOUNT_ID = 'ark:custom-baowenmao';
const AUDIT_MODEL = 'ark:ep-20250911202653-fr9dl';

const AUDIT_SYSTEM_PROMPT = [
  '你是执行命令安全审计器。',
  '你只输出 JSON，不要输出其它文本。',
  'JSON 格式必须是 {"decision":"ALLOW|BLOCK"}。',
  '当命令可能涉及破坏性、越权、敏感信息泄露、持久化后门、禁用安全机制时，倾向 BLOCK。',
  '其它情况输出 ALLOW。',
].join('');

interface Credentials {
  token: string;
  baseUrl: string;
}

async function getCredentials(): Promise<Credentials | null> {
  const secret = await getProviderSecret(AUDIT_ACCOUNT_ID);
  const token =
    secret?.type === 'api_key'
      ? secret.apiKey
      : secret?.type === 'local'
        ? (secret.apiKey ?? null)
        : null;

  if (!token) return null;

  const store = await getClawXProviderStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, any>;
  const baseUrl = accounts[AUDIT_ACCOUNT_ID]?.baseUrl as string | undefined;

  if (!baseUrl) return null;
  return { token, baseUrl };
}

function parseResponsesText(data: ResponsesApiResponse): string {
  let text = '';
  for (const item of data.output ?? []) {
    if (item.type !== 'message' || !item.content) continue;
    for (const block of item.content) {
      if (block.type === 'output_text' && block.text) {
        text += block.text;
      }
    }
  }
  return text.trim();
}

function normalizeDecision(value: unknown): AuditDecision | null {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  if (upper === 'ALLOW' || upper === 'BLOCK') {
    return upper;
  }
  return null;
}

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const codeFence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (codeFence?.[1]) {
    return codeFence[1].trim();
  }
  const jsonLike = trimmed.match(/\{[\s\S]*\}/);
  if (jsonLike?.[0]) {
    return jsonLike[0].trim();
  }
  return '';
}

function parseAuditResponse(rawText: string): AuditResponseBody {
  const payloadText = extractJsonPayload(rawText);
  if (!payloadText) {
    return { decision: 'ALLOW' };
  }
  try {
    const parsed = JSON.parse(payloadText) as { decision?: unknown };
    const decision = normalizeDecision(parsed.decision);
    if (!decision) {
      return { decision: 'ALLOW' };
    }
    return { decision };
  } catch {
    return { decision: 'ALLOW' };
  }
}

async function runAudit(body: AuditRequestBody): Promise<AuditResponseBody> {
  const creds = await getCredentials();
  if (!creds) {
    return { decision: 'ALLOW' };
  }

  const { token, baseUrl } = creds;
  const responsesUrl = `${baseUrl}/responses`;
  const inputText = JSON.stringify({
    tool: body.toolName || 'exec',
    command: body.command || '',
    sessionId: body.sessionId || '',
    callId: body.callId || '',
    cwd: body.cwd || '',
  });

  const reqBody = {
    model: AUDIT_MODEL,
    stream: false,
    extra_body: { thinking: { type: 'disabled' } },
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: AUDIT_SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: inputText }],
      },
    ],
  };

  const response = await fetch(responsesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error('[ai-exec-audit] backend error', response.status, errText);
    throw new Error(`Audit API ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ResponsesApiResponse;
  const text = parseResponsesText(data);
  return parseAuditResponse(text);
}

export async function handleAiExecAuditRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname !== '/api/ai-exec-audit/check') {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  try {
    const body = await parseJsonBody<AuditRequestBody>(req);
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    if (!command) {
      sendJson(res, 400, { error: 'Missing command' });
      return true;
    }

    const result = await runAudit(body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: 'audit_failed', message: String(error) });
  }

  return true;
}
