import { homedir } from "node:os";
import { join } from "node:path";

// Set ARBITER_HOME before importing anything that uses it
if (!process.env.ARBITER_HOME) {
  process.env.ARBITER_HOME = join(homedir(), ".arbiter");
}

const VERSION = process.env.ARBITER_VERSION || "0.1.0";
const command = process.argv[2];
const subcommand = process.argv[3];

switch (command) {
  case "serve":
    await import("./commands/serve.js");
    break;

  case "hook":
    if (subcommand === "pre-tool-use") {
      const { preToolUse } = await import("./commands/hook.js");
      await preToolUse();
    } else if (subcommand === "post-tool-use") {
      const { postToolUse } = await import("./commands/hook.js");
      await postToolUse();
    } else {
      console.error(`Unknown hook: ${subcommand}`);
      console.error("Usage: arbiter hook <pre-tool-use|post-tool-use>");
      process.exit(1);
    }
    break;

  case "init":
    const { init } = await import("./commands/init.js");
    await init();
    break;

  case "doctor":
    const { doctor } = await import("./commands/doctor.js");
    await doctor();
    break;

  case "version":
  case "--version":
  case "-v":
    console.log(`arbiter v${VERSION}`);
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(`
arbiter v${VERSION} — Adaptive permission governance for AI coding assistants

Usage:
  arbiter init              Set up Arbiter for the first time
  arbiter serve             Run the MCP server (called by Claude Code)
  arbiter hook <type>       Run a hook handler (called by Claude Code)
  arbiter doctor            Diagnose common issues
  arbiter version           Show version

Hooks:
  arbiter hook pre-tool-use     Evaluate permissions before a tool runs
  arbiter hook post-tool-use    Record approvals after a tool runs

Learn more: https://github.com/SethDrew/arbiter
`.trim());
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Run 'arbiter help' for usage information.");
    process.exit(1);
}
