// Arbiter Doctor — Diagnose common issues

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export async function doctor(): Promise<void> {
  console.log("\n  Arbiter Doctor\n");

  const checks: Check[] = [];
  const home = homedir();
  const arbiterHome = process.env.ARBITER_HOME || join(home, ".arbiter");

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: "Node.js version",
    status: major >= 20 ? "pass" : "fail",
    message: `${nodeVersion}${major < 20 ? " (requires >= 20)" : ""}`,
  });

  // 2. ARBITER_HOME directory
  checks.push({
    name: "Data directory",
    status: existsSync(arbiterHome) ? "pass" : "fail",
    message: existsSync(arbiterHome)
      ? arbiterHome
      : `${arbiterHome} not found — run 'arbiter init'`,
  });

  // 3. Contexts directory
  const contextsDir = join(arbiterHome, "contexts");
  if (existsSync(contextsDir)) {
    const contexts = readdirSync(contextsDir).filter((f) =>
      f.endsWith(".json")
    );
    checks.push({
      name: "Contexts",
      status: contexts.length > 0 ? "pass" : "warn",
      message:
        contexts.length > 0
          ? `${contexts.length} context(s): ${contexts.map((f) => f.replace(".json", "")).join(", ")}`
          : "No contexts defined",
    });
  } else {
    checks.push({
      name: "Contexts",
      status: "fail",
      message: "contexts/ directory not found",
    });
  }

  // 4. Data files
  const dataDir = join(arbiterHome, "data");
  for (const file of [
    "active-context.json",
    "preferences.json",
  ]) {
    const path = join(dataDir, file);
    checks.push({
      name: `Data: ${file}`,
      status: existsSync(path) ? "pass" : "fail",
      message: existsSync(path) ? "exists" : "missing",
    });
  }

  // 5. Active context validity
  try {
    const activeData = JSON.parse(
      readFileSync(join(dataDir, "active-context.json"), "utf-8")
    );
    const ctxFile =
      activeData.active_context.toLowerCase().replace(/\s+/g, "-") + ".json";
    const ctxExists = existsSync(join(contextsDir, ctxFile));
    checks.push({
      name: "Active context",
      status: ctxExists ? "pass" : "fail",
      message: ctxExists
        ? `"${activeData.active_context}"`
        : `"${activeData.active_context}" — context file not found`,
    });
  } catch {
    checks.push({
      name: "Active context",
      status: "fail",
      message: "Could not read active-context.json",
    });
  }

  // 6. Claude Code settings
  const globalSettings = join(home, ".claude", "settings.local.json");
  if (existsSync(globalSettings)) {
    try {
      const settings = JSON.parse(readFileSync(globalSettings, "utf-8"));
      const hasPreHook = JSON.stringify(settings).includes(
        "arbiter hook pre-tool-use"
      );
      const hasPostHook = JSON.stringify(settings).includes(
        "arbiter hook post-tool-use"
      );
      checks.push({
        name: "PreToolUse hook",
        status: hasPreHook ? "pass" : "warn",
        message: hasPreHook
          ? "configured in global settings"
          : "not found in global settings (may be project-level)",
      });
      checks.push({
        name: "PostToolUse hook",
        status: hasPostHook ? "pass" : "warn",
        message: hasPostHook
          ? "configured in global settings"
          : "not found in global settings (may be project-level)",
      });
    } catch {
      checks.push({
        name: "Claude Code settings",
        status: "warn",
        message: "Could not parse settings.local.json",
      });
    }
  } else {
    // Check project-level
    const projectSettings = join(
      process.cwd(),
      ".claude",
      "settings.local.json"
    );
    if (existsSync(projectSettings)) {
      checks.push({
        name: "Claude Code settings",
        status: "pass",
        message: "Found project-level settings",
      });
    } else {
      checks.push({
        name: "Claude Code settings",
        status: "fail",
        message:
          "No settings found — run 'arbiter init' to configure hooks",
      });
    }
  }

  // 7. MCP config
  for (const mcpPath of [
    join(home, ".claude", ".mcp.json"),
    join(process.cwd(), ".mcp.json"),
  ]) {
    if (existsSync(mcpPath)) {
      try {
        const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
        const hasArbiter = mcp.mcpServers?.arbiter;
        if (hasArbiter) {
          checks.push({
            name: "MCP server",
            status: "pass",
            message: `configured in ${mcpPath}`,
          });
          break;
        }
      } catch {
        /* skip */
      }
    }
  }
  if (!checks.find((c) => c.name === "MCP server")) {
    checks.push({
      name: "MCP server",
      status: "fail",
      message: "Arbiter MCP server not found in any .mcp.json",
    });
  }

  // 8. Audit log
  const auditPath = join(dataDir, "audit.log");
  if (existsSync(auditPath)) {
    const content = readFileSync(auditPath, "utf-8").trim();
    const lines = content ? content.split("\n").length : 0;
    checks.push({
      name: "Audit log",
      status: "pass",
      message: `${lines} entries`,
    });
  } else {
    checks.push({
      name: "Audit log",
      status: "warn",
      message: "No audit log yet (will be created on first use)",
    });
  }

  // Print results
  let hasFailures = false;
  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? "  [OK]"
        : check.status === "warn"
          ? "  [!!]"
          : "  [XX]";
    console.log(`${icon}  ${check.name}: ${check.message}`);
    if (check.status === "fail") hasFailures = true;
  }

  console.log("");
  if (hasFailures) {
    console.log(
      "  Some checks failed. Run 'arbiter init' to fix common issues.\n"
    );
    process.exit(1);
  } else {
    console.log("  Everything looks good!\n");
  }
}
