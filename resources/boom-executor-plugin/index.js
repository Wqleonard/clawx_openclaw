const BOOM_EXECUTOR_GUARD_LOG_TAG = "boom-executor-guard";
const BOOM_EXECUTOR_GUARD_CONFIG_PATH = "/plugins/boom-executor-guard/config";
const BOOM_EXECUTOR_GUARD_TOOLS = new Set(["exec", "bash", "bash_tool", "execute_command", "run_command", "shell", "powershell"]);
const BOOM_EXECUTOR_FILE_NAME = "boom-executor.exe";

const runtimeState = {
  config: {
    enabled: true,
    auditLog: true,
  },
};

function normalizeConfig(input) {
  return {
    enabled: input?.enabled !== false,
    auditLog: input?.auditLog !== false,
  };
}

function isExecTool(name) {
  return BOOM_EXECUTOR_GUARD_TOOLS.has(String(name || "").trim().toLowerCase());
}

function getLauncherArgs() {
  return "--integrity-floor --cap-drop-token --process-cage";
}

function resolvePowerShellPath() {
  if (process.platform !== "win32") return "powershell.exe";
  const fs = require("fs");
  const path = require("path");
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const candidates = [
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path.join(systemRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return "powershell.exe";
}

function resolveExecutorPath() {
  if (process.platform !== "win32") return "";
  const fs = require("fs");
  const path = require("path");

  const candidates = [];
  if (typeof process.resourcesPath === "string" && process.resourcesPath.trim()) {
    candidates.push(path.join(process.resourcesPath, "bin", BOOM_EXECUTOR_FILE_NAME));
  }
  candidates.push(path.join(process.cwd(), "bin", BOOM_EXECUTOR_FILE_NAME));
  candidates.push(path.join(process.cwd(), "..", "bin", BOOM_EXECUTOR_FILE_NAME));
  candidates.push(path.join(process.cwd(), "..", "..", "bin", BOOM_EXECUTOR_FILE_NAME));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return "";
}

function wrapCommand(command, wrapperPath) {
  const escaped = String(command || "").replace(/'/g, "''");
  const launcherArgs = getLauncherArgs();
  const psPath = resolvePowerShellPath();
  return `& '${wrapperPath}' ${launcherArgs} -- "${psPath}" -NoProfile -NonInteractive -Command '${escaped}'`;
}

function commandPreview(command) {
  const text = String(command || "").replace(/\s+/g, " ").trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 240)}...`;
}

const plugin = {
  id: "boom-executor-guard",
  name: "Boom Executor Guard",
  description: "Uniformly wrap exec commands with Boom executor.",

  register(api) {
    runtimeState.config = normalizeConfig(api.pluginConfig || {});

    const wrapperPath = resolveExecutorPath();
    api.registerHttpRoute({
      path: BOOM_EXECUTOR_GUARD_CONFIG_PATH,
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
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true, config: runtimeState.config }));
          return true;
        }
        res.writeHead(405);
        res.end("Method Not Allowed");
        return true;
      },
    });

    api.on("before_tool_call", async (event) => {
      const config = runtimeState.config;
      if (!config.enabled) return;
      if (process.platform !== "win32") return;
      if (!isExecTool(event.toolName)) return;

      const command = typeof event.params?.command === "string" ? event.params.command : "";
      if (!command) return;
      if (!wrapperPath) {
        if (config.auditLog) {
          const noWrapperMessage = `[${BOOM_EXECUTOR_GUARD_LOG_TAG}] wrapper missing, pass-through tool=${event.toolName} callId=${event.toolCallId || ""}`;
          console.warn(noWrapperMessage);
          api.logger.warn(noWrapperMessage);
        }
        return;
      }

      if (config.auditLog) {
        const inputMessage = `[${BOOM_EXECUTOR_GUARD_LOG_TAG}] input tool=${event.toolName} callId=${event.toolCallId || ""} cmd="${commandPreview(command)}"`;
        console.log(inputMessage);
        api.logger.warn(inputMessage);
      }

      const wrappedCommand = wrapCommand(command, wrapperPath);
      if (config.auditLog) {
        const rewriteMessage = `[${BOOM_EXECUTOR_GUARD_LOG_TAG}] rewrite tool=${event.toolName} callId=${event.toolCallId || ""} mode=strict cmd="${commandPreview(wrappedCommand)}"`;
        console.log(rewriteMessage);
        api.logger.warn(rewriteMessage);
      }

      return {
        params: { ...event.params, command: wrappedCommand },
      };
    });

    api.logger.info(
      `[${BOOM_EXECUTOR_GUARD_LOG_TAG}] ready platform=${process.platform} wrapper=${wrapperPath || "none"} mode=strict`,
    );
  },
};

export default plugin;
