// Arbiter Init — Interactive setup wizard
// Creates ~/.arbiter/ with contexts and data, wires Claude Code hooks and MCP.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

function ask(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function findTemplatesDir(): string {
  // When running from the bundled CLI, templates/ is sibling to dist/
  // When running from source, templates/ is at project root
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "templates"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates"),
    join(process.cwd(), "templates"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    "Could not find templates directory. Make sure arbiter is installed correctly."
  );
}

function mergeJsonFile(
  filePath: string,
  updates: Record<string, unknown>
): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      /* start fresh */
    }
  }
  const merged = deepMerge(existing, updates);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n");
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeAllowList(
  filePath: string,
  newEntries: string[]
): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      /* start fresh */
    }
  }
  const permissions = (existing.permissions || {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  for (const entry of newEntries) {
    if (!allow.includes(entry)) allow.push(entry);
  }
  permissions.allow = allow;
  existing.permissions = permissions;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}

// --- OpenClaw detection ---

interface OpenClawDetection {
  configFound: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayMode: string;
  gatewayUp: boolean;
  mcpBridgePath: string | null; // absolute path if globally installed, null otherwise
}

function detectOpenClawConfig(): {
  found: boolean;
  url: string;
  token: string;
  mode: string;
  chatCompletionsEnabled: boolean;
} {
  const openclawHome = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
  const configPath = join(openclawHome, "openclaw.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const gw = config?.gateway;
    if (!gw || !gw.port) {
      return { found: false, url: "", token: "", mode: "", chatCompletionsEnabled: false };
    }
    const port = gw.port;
    const mode = gw.mode || "local";
    const token = gw.auth?.token || "";
    const chatCompletionsEnabled = gw.http?.endpoints?.chatCompletions?.enabled === true;
    const url = `http://127.0.0.1:${port}`;

    return { found: true, url, token, mode, chatCompletionsEnabled };
  } catch {
    return { found: false, url: "", token: "", mode: "", chatCompletionsEnabled: false };
  }
}

async function checkGatewayHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await globalThis.fetch(`${url}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

function findMcpBridgePath(): string | null {
  try {
    // Check if openclaw-mcp is globally installed via npm
    const result = execSync("which openclaw-mcp 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    if (result) return result;
  } catch {
    // not on PATH
  }

  try {
    // Check npm global prefix for the binary
    const prefix = execSync("npm prefix -g 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    const candidate = join(prefix, "bin", "openclaw-mcp");
    if (existsSync(candidate)) return candidate;
  } catch {
    // npm not available or errored
  }

  return null;
}

async function detectOpenClaw(): Promise<OpenClawDetection> {
  const config = detectOpenClawConfig();
  const mcpBridgePath = findMcpBridgePath();
  let gatewayUp = false;

  if (config.found) {
    gatewayUp = await checkGatewayHealth(config.url);
  }

  return {
    configFound: config.found,
    gatewayUrl: config.url,
    gatewayToken: config.token,
    gatewayMode: config.mode,
    gatewayUp,
    mcpBridgePath,
  };
}

// --- Main init flow ---

export async function init(): Promise<void> {
  console.log("\n  Arbiter — Setup Wizard\n");

  const home = homedir();
  const arbiterHome =
    process.env.ARBITER_HOME || join(home, ".arbiter");

  // Step 1: Create data directory
  console.log(`  Data directory: ${arbiterHome}`);
  if (existsSync(arbiterHome)) {
    console.log("  (already exists)\n");
  } else {
    mkdirSync(arbiterHome, { recursive: true });
    console.log("  (created)\n");
  }

  // Create subdirectories
  const contextsDir = join(arbiterHome, "contexts");
  const dataDir = join(arbiterHome, "data");
  mkdirSync(contextsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  // Step 2: Copy default contexts (don't overwrite existing)
  const templatesDir = findTemplatesDir();

  const defaultContexts = ["daily-life.json", "court-case.json"];
  for (const ctx of defaultContexts) {
    const dest = join(contextsDir, ctx);
    if (!existsSync(dest)) {
      copyFileSync(join(templatesDir, "contexts", ctx), dest);
      console.log(`  Copied default context: ${ctx}`);
    } else {
      console.log(`  Context already exists: ${ctx} (keeping yours)`);
    }
  }

  // Step 3: Initialize data files
  const activeCtxPath = join(dataDir, "active-context.json");
  if (!existsSync(activeCtxPath)) {
    writeFileSync(
      activeCtxPath,
      JSON.stringify(
        {
          active_context: "daily-life",
          switched_at: new Date().toISOString(),
        },
        null,
        2
      ) + "\n"
    );
    console.log("  Initialized active context: daily-life");
  }

  const prefsPath = join(dataDir, "preferences.json");
  if (!existsSync(prefsPath)) {
    writeFileSync(prefsPath, "{}\n");
    console.log("  Initialized preferences");
  }

  const auditPath = join(dataDir, "audit.log");
  if (!existsSync(auditPath)) {
    writeFileSync(auditPath, "");
    console.log("  Initialized audit log");
  }

  console.log("");

  // Step 4: Architecture choice
  const archChoice = await ask(
    "  How would you like to use Arbiter?\n\n" +
      "  1. Permission governance\n" +
      "     Arbiter manages what Claude can and can't do — contexts, learning, audit.\n\n" +
      "  2. Full assistant (requires OpenClaw)\n" +
      "     All of the above, plus email, calendar, and services via OpenClaw.\n\n" +
      "  ",
    "1"
  );

  const fullAssistant = archChoice === "2";

  // Step 5: Scope question
  const scope = await ask(
    "\n  Set up Arbiter globally or for a specific project?\n  (g)lobal or (p)roject path",
    "p"
  );

  let claudeConfigDir: string;
  let mcpConfigPath: string;

  if (scope === "g" || scope === "global") {
    claudeConfigDir = join(home, ".claude");
    mcpConfigPath = join(home, ".claude", ".mcp.json");
  } else {
    let projectPath: string;
    if (scope === "p" || scope === "project") {
      projectPath = await ask("  Project path", process.cwd());
    } else {
      // User typed a path directly
      projectPath = scope;
    }
    claudeConfigDir = join(projectPath, ".claude");
    mcpConfigPath = join(projectPath, ".mcp.json");
  }

  mkdirSync(claudeConfigDir, { recursive: true });

  // Step 6: Add MCP server config
  const mcpConfig: Record<string, unknown> = {
    mcpServers: {
      arbiter: {
        command: "arbiter",
        args: ["serve"],
        env: {},
      },
    },
  };
  mergeJsonFile(mcpConfigPath, mcpConfig);
  console.log(`  Added Arbiter MCP server to ${mcpConfigPath}`);

  // Step 7: Add hooks to settings
  const settingsPath = join(claudeConfigDir, "settings.local.json");
  const hooksConfig = {
    hooks: {
      PreToolUse: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: "arbiter hook pre-tool-use",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: "arbiter hook post-tool-use",
            },
          ],
        },
      ],
    },
  };
  mergeJsonFile(settingsPath, hooksConfig);

  // Add Arbiter MCP tools to permission allow list
  mergeAllowList(settingsPath, ["mcp__arbiter__*"]);
  console.log(`  Added hooks and permissions to ${settingsPath}`);

  // Step 7b: Check for MCP server enablement
  const settingsData = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const enabledServers: string[] = settingsData.enabledMcpjsonServers || [];
  if (!enabledServers.includes("arbiter")) {
    enabledServers.push("arbiter");
    settingsData.enabledMcpjsonServers = enabledServers;
    writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2) + "\n");
  }

  // Step 8: OpenClaw detection (only if full assistant) — runs before CLAUDE.md so we know the outcome
  let openclawSummary = "";
  let openclawConfigured = false;

  if (fullAssistant) {
    console.log("\n  Detecting OpenClaw...\n");
    const detection = await detectOpenClaw();

    if (detection.configFound && detection.gatewayUp) {
      // All good — auto-configure
      const bridgeLabel = detection.mcpBridgePath
        ? detection.mcpBridgePath
        : "npx openclaw-mcp";

      console.log("  \u2713 OpenClaw config found (~/.openclaw/openclaw.json)");
      console.log(`  \u2713 Gateway responding at ${detection.gatewayUrl}`);
      console.log(`  \u2713 MCP bridge: ${bridgeLabel}`);

      // Check if chatCompletions endpoint is enabled (required for MCP bridge)
      const ocConfig = detectOpenClawConfig();
      if (!ocConfig.chatCompletionsEnabled) {
        console.log(
          "\n  !! chatCompletions endpoint is disabled in OpenClaw config." +
          "\n     The MCP bridge requires it. Enable it in ~/.openclaw/openclaw.json:" +
          '\n     gateway.http.endpoints.chatCompletions.enabled = true'
        );
      }

      const openclawMcpConfig: Record<string, unknown> = {
        mcpServers: {
          openclaw: detection.mcpBridgePath
            ? {
                command: detection.mcpBridgePath,
                args: [
                  "--openclaw-url",
                  detection.gatewayUrl,
                  "--gateway-token",
                  detection.gatewayToken,
                ],
                env: {},
              }
            : {
                command: "npx",
                args: [
                  "openclaw-mcp",
                  "--openclaw-url",
                  detection.gatewayUrl,
                  "--gateway-token",
                  detection.gatewayToken,
                ],
                env: {},
              },
        },
      };

      mergeJsonFile(mcpConfigPath, openclawMcpConfig);
      mergeAllowList(settingsPath, ["mcp__openclaw__*"]);

      // Enable OpenClaw MCP server
      const updatedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const servers: string[] = updatedSettings.enabledMcpjsonServers || [];
      if (!servers.includes("openclaw")) {
        servers.push("openclaw");
        updatedSettings.enabledMcpjsonServers = servers;
        writeFileSync(
          settingsPath,
          JSON.stringify(updatedSettings, null, 2) + "\n"
        );
      }

      console.log("\n  OpenClaw integration configured automatically.");
      openclawSummary = `${detection.gatewayUrl} (auto-detected)`;
      openclawConfigured = true;
    } else if (detection.configFound && !detection.gatewayUp) {
      // Config exists but gateway not responding
      console.log("  \u2713 OpenClaw config found (~/.openclaw/openclaw.json)");
      console.log(
        `  \u2717 Gateway not responding at ${detection.gatewayUrl}`
      );
      console.log(
        "\n  OpenClaw is configured but not running."
      );
      console.log(
        "  Start it and re-run 'arbiter init', or continue without it."
      );

      const continueAnyway = await ask(
        "\n  Continue without OpenClaw? (y/n)",
        "y"
      );
      if (continueAnyway !== "y" && continueAnyway !== "yes") {
        console.log("\n  Aborted. Start OpenClaw and re-run 'arbiter init'.");
        return;
      }
      openclawSummary = "not configured (gateway not responding)";
    } else {
      // Nothing found
      console.log("  No local OpenClaw installation found.\n");
      const remoteOC = await ask(
        "  Is OpenClaw running on another machine? (y/n)",
        "n"
      );

      if (remoteOC === "y" || remoteOC === "yes") {
        const gatewayUrl = await ask(
          "  OpenClaw gateway URL",
          "http://127.0.0.1:18789"
        );
        const gatewayToken = await ask("  OpenClaw gateway token");

        const openclawMcpConfig: Record<string, unknown> = {
          mcpServers: {
            openclaw: {
              command: "npx",
              args: [
                "openclaw-mcp",
                "--openclaw-url",
                gatewayUrl,
                "--gateway-token",
                gatewayToken,
              ],
              env: {},
            },
          },
        };

        mergeJsonFile(mcpConfigPath, openclawMcpConfig);
        mergeAllowList(settingsPath, ["mcp__openclaw__*"]);

        // Enable OpenClaw MCP server
        const updatedSettings = JSON.parse(
          readFileSync(settingsPath, "utf-8")
        );
        const servers: string[] =
          updatedSettings.enabledMcpjsonServers || [];
        if (!servers.includes("openclaw")) {
          servers.push("openclaw");
          updatedSettings.enabledMcpjsonServers = servers;
          writeFileSync(
            settingsPath,
            JSON.stringify(updatedSettings, null, 2) + "\n"
          );
        }

        console.log("\n  OpenClaw integration configured.");
        openclawSummary = `${gatewayUrl} (manual)`;
        openclawConfigured = true;
      } else {
        console.log(
          "\n  Visit openclaw.dev to install OpenClaw, then re-run 'arbiter init'."
        );
        openclawSummary = "not configured";
      }
    }
  }

  // Step 9: Write CLAUDE.md personality
  let arbiterInstructions = readFileSync(
    join(templatesDir, "claude.md"),
    "utf-8"
  );

  if (openclawConfigured) {
    arbiterInstructions += `
### OpenClaw — Services Integration

You have access to OpenClaw via the \`openclaw_chat\` tool. This is how you interact with external services like email, calendar, and messaging.

- **To read email**: \`openclaw_chat\` with a message like "check my recent emails" or "find emails from [person]"
- **To send email**: \`openclaw_chat\` with "send an email to [address] about [subject]" — Arbiter will ask the user for confirmation first
- **To check calendar**: \`openclaw_chat\` with "what's on my calendar today?"
- **To check status**: Use \`openclaw_status\` to verify the gateway is connected

OpenClaw handles the service connections (Gmail, Google Calendar, etc.). You just describe what you need in plain language via \`openclaw_chat\`.
`;
  }

  const claudeMdPath =
    scope === "g" || scope === "global"
      ? join(home, ".claude", "CLAUDE.md")
      : join(mcpConfigPath, "..", "CLAUDE.md");

  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, "utf-8");
    if (!existing.includes("## Arbiter")) {
      writeFileSync(
        claudeMdPath,
        existing + "\n\n" + arbiterInstructions + "\n"
      );
      console.log(`  Added Arbiter instructions to ${claudeMdPath}`);
    } else {
      console.log(
        `  Arbiter instructions already in ${claudeMdPath} (keeping yours)`
      );
    }
  } else {
    writeFileSync(claudeMdPath, arbiterInstructions + "\n");
    console.log(`  Created ${claudeMdPath} with Arbiter instructions`);
  }

  // Summary
  if (fullAssistant) {
    const openclawLine = openclawSummary
      ? `\n  OpenClaw:  ${openclawSummary}`
      : "";
    console.log(`
  \u2713 Setup complete — Full Assistant

  Data:      ${arbiterHome}/
  MCP:       ${mcpConfigPath}
  Hooks:     ${settingsPath}${openclawLine}

  Run 'arbiter doctor' to verify, then 'claude' to start.
`);
  } else {
    console.log(`
  \u2713 Setup complete — Permission Governance

  Data:    ${arbiterHome}/
  MCP:     ${mcpConfigPath}
  Hooks:   ${settingsPath}

  Run 'arbiter doctor' to verify, then 'claude' to start.
`);
  }
}
