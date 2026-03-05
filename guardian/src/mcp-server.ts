import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getActiveContext,
  setActiveContext,
  listContextNames,
  loadContext,
  loadAllContexts,
  createContext,
} from "./context-manager.js";
import { readRecentAudit } from "./audit-logger.js";
import {
  getPreferenceSuggestions,
  confirmLearning,
  loadPreferences,
} from "./preference-tracker.js";

const server = new McpServer({
  name: "arbiter",
  version: "0.1.0",
});

// Tool 1: guardian_get_status
server.tool(
  "guardian_get_status",
  "Show the active context, recent activity stats, and any pending preference suggestions",
  {},
  async () => {
    const active = getActiveContext();
    const ctx = loadContext(active.active_context);
    const recent = readRecentAudit(50);
    const suggestions = getPreferenceSuggestions(active.active_context);

    const stats = { allowed: 0, denied: 0, asked: 0 };
    for (const entry of recent) {
      if (entry.decision === "allow") stats.allowed++;
      else if (entry.decision === "deny") stats.denied++;
      else stats.asked++;
    }

    const lines: string[] = [
      `Active context: ${ctx.name}`,
      `Description: ${ctx.description}`,
      `Audit level: ${ctx.audit_level}`,
      `Switched at: ${active.switched_at}`,
      ``,
      `Recent activity (last 50 actions):`,
      `  Auto-approved: ${stats.allowed}`,
      `  Asked for permission: ${stats.asked}`,
      `  Denied: ${stats.denied}`,
    ];

    if (suggestions.length > 0) {
      lines.push(``, `Preference suggestions:`);
      for (const s of suggestions) {
        const examples = s.recentInputs.join(", ");
        lines.push(
          `  ${s.description} — approved ${s.count} times (e.g. ${examples}). Want me to auto-approve ${s.description.toLowerCase()} in ${active.active_context}, or everywhere?`
        );
      }
    }

    // Show learned preferences
    const allPrefs = loadPreferences();
    const ctxPrefs = allPrefs[active.active_context] || [];
    const learned = ctxPrefs.filter((p) => p.learned_scope !== null);
    if (learned.length > 0) {
      lines.push(``, `Learned preferences:`);
      for (const p of learned) {
        lines.push(
          `  ${p.description} — auto-approved (${p.learned_scope} scope)`
        );
      }
    }

    if (ctx.behavior_notes.length > 0) {
      lines.push(``, `Behavior notes:`);
      for (const note of ctx.behavior_notes) {
        lines.push(`  - ${note}`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool 2: guardian_switch_context
server.tool(
  "guardian_switch_context",
  "Switch to a different permission context",
  { name: z.string().describe("Name of the context to switch to") },
  async ({ name }) => {
    try {
      setActiveContext(name);
      const ctx = loadContext(name);
      return {
        content: [
          {
            type: "text",
            text: `Switched to "${name}" context.\n\n${ctx.description}\n\nRules:\n- Auto-approve: ${ctx.policies.auto_approve.length} rules\n- Always ask: ${ctx.policies.always_ask.length} rules\n- Deny: ${ctx.policies.deny.length} rules`,
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// Tool 3: guardian_list_contexts
server.tool(
  "guardian_list_contexts",
  "List all available permission contexts with their descriptions",
  {},
  async () => {
    const contexts = loadAllContexts();
    const active = getActiveContext();
    const lines = contexts.map((ctx) => {
      const marker = ctx.name === active.active_context ? " (active)" : "";
      return `${ctx.name}${marker}\n  ${ctx.description}\n  Rules: ${ctx.policies.auto_approve.length} auto-approve, ${ctx.policies.always_ask.length} ask, ${ctx.policies.deny.length} deny`;
    });
    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  }
);

// Tool 4: guardian_create_context
server.tool(
  "guardian_create_context",
  "Create a new permission context, optionally cloned from an existing one",
  {
    name: z.string().describe("Name for the new context"),
    description: z.string().describe("What this context is for"),
    clone_from: z
      .string()
      .optional()
      .describe("Name of existing context to clone rules from"),
  },
  async ({ name, description, clone_from }) => {
    try {
      const ctx = createContext(name, description, clone_from);
      return {
        content: [
          {
            type: "text",
            text: `Created context "${ctx.name}".\n${ctx.description}\n\n${clone_from ? `Cloned rules from "${clone_from}".` : "Started with blank rules — you'll want to add some policies."}`,
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// Tool 5: guardian_get_policy
server.tool(
  "guardian_get_policy",
  "Show the current context's rules in plain English",
  {},
  async () => {
    const active = getActiveContext();
    const ctx = loadContext(active.active_context);
    const lines: string[] = [`Rules for "${ctx.name}":\n`];

    if (ctx.policies.auto_approve.length > 0) {
      lines.push("Things I'll do automatically (no need to ask):");
      for (const r of ctx.policies.auto_approve) {
        lines.push(`  - ${r.reason}`);
      }
    }

    if (ctx.policies.always_ask.length > 0) {
      lines.push("\nThings I'll always ask about first:");
      for (const r of ctx.policies.always_ask) {
        lines.push(`  - ${r.reason}`);
      }
    }

    if (ctx.policies.deny.length > 0) {
      lines.push("\nThings I won't do in this context:");
      for (const r of ctx.policies.deny) {
        lines.push(`  - ${r.reason}`);
      }
    }

    if (ctx.policies.auto_approve.length === 0 && ctx.policies.always_ask.length === 0 && ctx.policies.deny.length === 0) {
      lines.push("No rules configured yet — I'll ask about everything.");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool 6: guardian_learn_preference
server.tool(
  "guardian_learn_preference",
  "Tell Guardian to auto-approve a specific tool+signature pattern, either in the current context or globally. Use 'description' to provide a human-readable label for what this permission covers.",
  {
    tool: z
      .string()
      .describe("Tool name (e.g. 'Bash', 'Write', 'Edit', 'WebFetch', 'mcp__gmail__read_emails')"),
    input_signature: z
      .string()
      .describe(
        "Input signature to match (e.g. 'npm' for npm commands, '*.ts' for .ts files, 'gmail/read_emails' for an MCP action)"
      ),
    scope: z
      .enum(["context", "global"])
      .describe(
        "'context' to auto-approve only in the active context, 'global' to auto-approve everywhere"
      ),
    description: z
      .string()
      .optional()
      .describe(
        "Human-readable description of what this permission covers (e.g. 'Reading your recent emails', 'Running package manager commands'). If not provided, uses the auto-generated description."
      ),
  },
  async ({ tool, input_signature, scope, description }) => {
    const active = getActiveContext();
    confirmLearning(
      active.active_context,
      tool,
      input_signature,
      scope,
      description
    );
    const displayDesc = description || `${tool} (${input_signature})`;
    const scopeDesc =
      scope === "global"
        ? "in all contexts"
        : `in the "${active.active_context}" context`;
    return {
      content: [
        {
          type: "text",
          text: `Got it — I'll auto-approve "${displayDesc}" ${scopeDesc} from now on. You can review learned preferences anytime with guardian_get_status.`,
        },
      ],
    };
  }
);

// Tool 7: guardian_audit_log
server.tool(
  "guardian_audit_log",
  "Show recent Guardian actions from the audit log",
  {
    count: z
      .number()
      .optional()
      .default(20)
      .describe("Number of recent entries to show (default 20)"),
    filter: z
      .enum(["all", "allow", "deny", "ask"])
      .optional()
      .default("all")
      .describe("Filter by decision type"),
  },
  async ({ count, filter }) => {
    let entries = readRecentAudit(count * 2); // fetch extra in case we filter
    if (filter !== "all") {
      entries = entries.filter((e) => e.decision === filter);
    }
    entries = entries.slice(0, count);

    if (entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No audit entries found" + (filter !== "all" ? ` with filter "${filter}"` : "") + ".",
          },
        ],
      };
    }

    const lines = entries.map((e) => {
      const time = new Date(e.timestamp).toLocaleString();
      return `[${time}] ${e.decision.toUpperCase()} — ${e.tool_name}\n  ${e.tool_input_summary}\n  Reason: ${e.reason}`;
    });

    return {
      content: [{ type: "text", text: lines.join("\n\n") }],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Guardian MCP server error: ${err}\n`);
  process.exit(1);
});
