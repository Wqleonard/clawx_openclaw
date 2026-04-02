import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BOOM_AI_EXEC_AUDIT_LOG_TAG = "ai-exec-audit";
const BOOM_AI_EXEC_AUDIT_CONFIG_PATH = "/plugins/ai-exec-audit/config";
const BOOM_AI_EXEC_AUDIT_HOST_API = "http://localhost:3210";
const BOOM_AI_EXEC_AUDIT_EXEC_TOOLS = new Set(["exec", "bash", "bash_tool", "execute_command", "run_command", "shell", "powershell"]);

const decisionCache = new Map();
const runtimeState = {
  failures: 0,
  openUntil: 0,
  config: null,
  logPath: "",
};

function commandPreview(command) {
  const text = String(command || "").replace(/\s+/g, " ").trim();
  if (text.length <= 220) return text;
  return `${text.slice(0, 220)}...`;
}

function now() {
  return Date.now();
}

function toInt(value, fallback) {
  const v = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

function normalizeConfig(input) {
  return {
    enabled: input?.enabled !== false,
    failureMode: input?.failureMode === "fail-close" ? "fail-close" : "fail-open",
    failureThreshold: toInt(input?.failureThreshold, 3),
    cooldownSeconds: toInt(input?.cooldownSeconds, 120),
    cacheTtlSeconds: toInt(input?.cacheTtlSeconds, 300),
    auditLog: input?.auditLog !== false,
    auditReportUrl: typeof input?.auditReportUrl === "string" ? input.auditReportUrl.trim() : "",
    stateDir: typeof input?.stateDir === "string" && input.stateDir.trim() ? input.stateDir.trim() : "",
  };
}

function isExecTool(name) {
  return BOOM_AI_EXEC_AUDIT_EXEC_TOOLS.has(String(name || "").trim().toLowerCase());
}

function hashCommand(command) {
  return createHash("sha256").update(command).digest("hex");
}

function getStateDir(config) {
  if (config.stateDir) return config.stateDir;
  if (typeof process.env.OPENCLAW_STATE_DIR === "string" && process.env.OPENCLAW_STATE_DIR.trim()) {
    return process.env.OPENCLAW_STATE_DIR.trim();
  }
  return join(homedir(), ".openclaw");
}

function getLogPath(config) {
  return join(getStateDir(config), "ai-exec-audit.jsonl");
}

function writeLocalLog(logPath, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, line, "utf8");
}

async function reportAudit(config, payload) {
  if (config.auditLog) {
    try {
      writeLocalLog(runtimeState.logPath, payload);
    } catch {}
  }
  if (!config.auditReportUrl) return;
  try {
    await fetch(config.auditReportUrl, {
      method: 'POST',
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

function normalizeDecision(value) {
  const decision = String(value || "").toUpperCase();
  if (decision === "ALLOW" || decision === "BLOCK") {
    return decision;
  }
  return "ALLOW";
}

function circuitOpen() {
  return now() < runtimeState.openUntil;
}

function onSuccess() {
  runtimeState.failures = 0;
}

function onFailure(config) {
  runtimeState.failures += 1;
  if (runtimeState.failures >= config.failureThreshold && !circuitOpen()) {
    runtimeState.openUntil = now() + config.cooldownSeconds * 1000;
  }
}

function decisionOnFailureMode(config) {
  if (config.failureMode === "fail-close") {
    return { decision: "BLOCK" };
  }
  return { decision: "ALLOW" };
}

async function remoteAudit(input) {
  const response = await fetch(`${BOOM_AI_EXEC_AUDIT_HOST_API}/api/ai-exec-audit/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: String(input.command || ""),
      toolName: String(input.toolName || "exec"),
      sessionId: String(input.context?.sessionKey || ""),
      callId: String(input.context?.toolCallId || ""),
      cwd: String(input.context?.cwd || ""),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`host-api ${response.status}: ${text.slice(0, 500)}`);
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return {
    decision: normalizeDecision(data.decision),
  };
}

const plugin = {
  id: "ai-exec-audit",
  name: "AI Exec Audit",
  description: "before_tool_call exec audit",
  register(api) {
    runtimeState.config = normalizeConfig(api.pluginConfig || {});
    runtimeState.logPath = getLogPath(runtimeState.config);

    api.registerHttpRoute({
      path: BOOM_AI_EXEC_AUDIT_CONFIG_PATH,
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if (req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(runtimeState.config));
          return true;
        }
        if (req.method === "POST" || req.method === "PUT") {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          runtimeState.config = normalizeConfig({ ...runtimeState.config, ...body });
          runtimeState.logPath = getLogPath(runtimeState.config);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true, config: runtimeState.config }));
          return true;
        }
        res.writeHead(405);
        res.end("Method Not Allowed");
        return true;
      },
    });

    api.on('before_tool_call', async (event, ctx) => {
      const config = runtimeState.config;
      if (!config.enabled) return;
      if (!isExecTool(event.toolName)) return;

      const command = typeof event.params?.command === "string" ? event.params.command : "";
      if (!command) return;
      const preview = commandPreview(command);
      const callId = event.toolCallId || "";
      const sessionKey = String(ctx?.sessionKey || "");
      const commandHash = hashCommand(command);

      const hitMessage = `[${BOOM_AI_EXEC_AUDIT_LOG_TAG}] hit before_tool_call tool=${event.toolName} callId=${callId} session=${sessionKey} cmd="${preview}"`;
      console.log(hitMessage);
      console.error(hitMessage);
      api.logger.warn(hitMessage);

      const h = commandHash;
      const cached = decisionCache.get(h);
      let result;
      let source = "remote";

      if (cached && now() < cached.expireAt) {
        result = { decision: cached.decision };
        source = "cache";
      } else if (circuitOpen()) {
        result = decisionOnFailureMode(config);
        source = "circuit";
      } else {
        try {
          result = await remoteAudit({
            command,
            toolName: event.toolName,
            context: {
              agentId: String(ctx?.agentId || ""),
              sessionKey: String(ctx?.sessionKey || ""),
              runId: String(ctx?.runId || ""),
              toolCallId: callId,
              cwd: String(event.params?.cwd || ""),
            },
          });
          onSuccess();
          decisionCache.set(h, {
            decision: result.decision,
            expireAt: now() + config.cacheTtlSeconds * 1000,
          });
        } catch {
          onFailure(config);
          result = decisionOnFailureMode(config);
          source = "failure";
        }
      }

      await reportAudit(config, {
        ts: new Date().toISOString(),
        plugin: BOOM_AI_EXEC_AUDIT_LOG_TAG,
        toolName: event.toolName,
        toolCallId: event.toolCallId || "",
        hash: h,
        source,
        decision: result.decision,
        context: {
          agentId: String(ctx?.agentId || ""),
          sessionKey: String(ctx?.sessionKey || ""),
          runId: String(ctx?.runId || ""),
        },
      });
      const decisionMessage = `[${BOOM_AI_EXEC_AUDIT_LOG_TAG}] decision tool=${event.toolName} callId=${callId} source=${source} decision=${result.decision} cmd="${preview}"`;
      console.log(decisionMessage);
      console.error(decisionMessage);
      api.logger.warn(decisionMessage);

      if (result.decision === "BLOCK") {
        const blockedMessage = `[${BOOM_AI_EXEC_AUDIT_LOG_TAG}] BLOCK tool=${event.toolName} callId=${callId} source=${source} cmd="${preview}"`;
        console.log(blockedMessage);
        api.logger.warn(blockedMessage);
        return {
          block: true,
          blockReason: `[${BOOM_AI_EXEC_AUDIT_LOG_TAG}] blocked by ai-exec-audit`,
        };
      }
      return;
    });

    api.logger.info(
      `[${BOOM_AI_EXEC_AUDIT_LOG_TAG}] ready at ${existsSync(runtimeState.logPath) ? runtimeState.logPath : getStateDir(runtimeState.config)}`,
    );
  },
};

export default plugin;
