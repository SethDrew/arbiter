// Arbiter Hook Handlers — PreToolUse and PostToolUse
// Replaces the standalone .mjs hook files with shared code from guardian modules.

import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractSignature } from "../../guardian/src/signatures.js";
import type {
  GuardianContext,
  PolicyRule,
  ContextualApproval,
  PreferencesData,
} from "../../guardian/src/types.js";

function getRoot(): string {
  return process.env.ARBITER_HOME!;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => resolve(input));
  });
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function matchesRule(
  toolName: string,
  toolInput: Record<string, unknown>,
  rule: PolicyRule
): boolean {
  if (!matchesPattern(toolName, rule.tool_pattern)) return false;
  if (rule.input_pattern) {
    const inputStr = JSON.stringify(toolInput);
    if (!matchesPattern(inputStr, rule.input_pattern)) return false;
  }
  return true;
}

function summarizeInput(toolInput: Record<string, unknown>): string {
  if (typeof toolInput.command === "string")
    return toolInput.command.slice(0, 120);
  if (typeof toolInput.file_path === "string") return toolInput.file_path;
  if (typeof toolInput.pattern === "string")
    return `pattern: ${toolInput.pattern}`;
  if (typeof toolInput.url === "string") return toolInput.url;
  return JSON.stringify(toolInput).slice(0, 120);
}

// ── PreToolUse Hook ─────────────────────────────────────────────────────────

export async function preToolUse(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const toolName: string = hookInput.tool_name;
    const toolInput: Record<string, unknown> = hookInput.tool_input || {};
    const root = getRoot();

    // Load active context
    let activeCtxName = "daily-life";
    try {
      const activeData = JSON.parse(
        readFileSync(join(root, "data", "active-context.json"), "utf-8")
      );
      activeCtxName = activeData.active_context;
    } catch {
      /* use default */
    }

    // Load context policies
    let context: GuardianContext;
    try {
      const filename =
        activeCtxName.toLowerCase().replace(/\s+/g, "-") + ".json";
      context = JSON.parse(
        readFileSync(join(root, "contexts", filename), "utf-8")
      );
    } catch {
      // No context file — allow everything
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Load preferences
    let preferences: ContextualApproval[] = [];
    try {
      const allPrefs: PreferencesData = JSON.parse(
        readFileSync(join(root, "data", "preferences.json"), "utf-8")
      );
      const ctxPrefs = allPrefs[activeCtxName];
      if (Array.isArray(ctxPrefs)) preferences = ctxPrefs;
    } catch {
      /* no prefs */
    }

    // Evaluate policy
    const policies = context.policies || {
      deny: [],
      always_ask: [],
      auto_approve: [],
    };
    let decision: "allow" | "deny" | "ask" = "ask";
    let reason = "No matching policy — asking for permission";
    let tier = "default";

    // Tier 1: deny
    for (const rule of policies.deny || []) {
      if (matchesRule(toolName, toolInput, rule)) {
        decision = "deny";
        reason = rule.reason;
        tier = "deny";
        break;
      }
    }

    // Tier 2: learned preferences (context-specific)
    if (tier === "default") {
      const sig = extractSignature(toolName, toolInput);
      for (const entry of preferences) {
        if (
          entry.learned_scope !== null &&
          entry.tool === toolName &&
          entry.input_signature === sig.signature
        ) {
          decision = "allow";
          reason = `Learned preference: ${entry.description} (${entry.learned_scope} scope)`;
          tier = "learned";
          break;
        }
      }

      // Check global learned preferences from other contexts
      if (tier === "default") {
        try {
          const allPrefs: PreferencesData = JSON.parse(
            readFileSync(join(root, "data", "preferences.json"), "utf-8")
          );
          for (const [ctx, entries] of Object.entries(allPrefs)) {
            if (ctx === activeCtxName || !Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (
                entry.learned_scope === "global" &&
                entry.tool === toolName &&
                entry.input_signature === sig.signature
              ) {
                decision = "allow";
                reason = `Learned preference: ${entry.description} (global, from ${ctx})`;
                tier = "learned";
                break;
              }
            }
            if (tier === "learned") break;
          }
        } catch {
          /* no prefs file */
        }
      }
    }

    // Tier 3: always_ask
    if (tier === "default") {
      for (const rule of policies.always_ask || []) {
        if (matchesRule(toolName, toolInput, rule)) {
          decision = "ask";
          reason = rule.reason;
          tier = "always_ask";
          break;
        }
      }
    }

    // Tier 4: auto_approve
    if (tier === "default") {
      for (const rule of policies.auto_approve || []) {
        if (matchesRule(toolName, toolInput, rule)) {
          decision = "allow";
          reason = rule.reason;
          tier = "auto_approve";
          break;
        }
      }
    }

    // Write audit log
    try {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        context: activeCtxName,
        tool_name: toolName,
        tool_input_summary: summarizeInput(toolInput),
        decision,
        reason,
        tier,
      };
      appendFileSync(
        join(root, "data", "audit.log"),
        JSON.stringify(auditEntry) + "\n"
      );
    } catch {
      /* audit failure is non-fatal */
    }

    // Build output
    const sig =
      tier !== "learned" ? extractSignature(toolName, toolInput) : null;
    const output: Record<string, unknown> = {};

    if (decision !== "ask") {
      output.hookSpecificOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      };
    }

    if (decision === "allow") {
      (output.hookSpecificOutput as Record<string, unknown>).additionalContext =
        "Arbiter auto-approved this action. Briefly explain what you're doing in plain, non-technical language.";
    } else if (decision === "deny") {
      (output.hookSpecificOutput as Record<string, unknown>).additionalContext =
        `Arbiter blocked this action: ${reason}. Explain to the user in simple terms why this isn't allowed right now.`;
    } else {
      // "ask" tier — classification context for Claude
      const inputSummary = summarizeInput(toolInput);
      const approvalCount = preferences.find(
        (p) =>
          p.tool === toolName &&
          p.input_signature === (sig && sig.signature)
      )?.count || 0;

      let classificationPrompt =
        `Arbiter needs your help classifying this action for the user. ` +
        `Context: "${activeCtxName}". Tool: ${toolName}. Action: ${inputSummary}. `;

      if (approvalCount > 0 && sig) {
        classificationPrompt += `Note: the user has approved similar actions (${sig.description}) ${approvalCount} time(s) before in this context. `;
      }

      classificationPrompt +=
        `When explaining this to the user, describe what this action DOES in plain terms ` +
        `(not the tool name), classify the risk level (routine/sensitive/significant), ` +
        `and explain why you're asking. Keep it conversational.`;

      output.hookSpecificOutput = {
        hookEventName: "PreToolUse",
        additionalContext: classificationPrompt,
      };
    }

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse" },
      })
    );
  }
}

// ── PostToolUse Hook ────────────────────────────────────────────────────────

export async function postToolUse(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const toolName: string = hookInput.tool_name;
    const toolInput: Record<string, unknown> = hookInput.tool_input || {};
    const root = getRoot();

    // Read the last audit log entry to check the tier
    let tier: string | null = null;
    try {
      const auditContent = readFileSync(
        join(root, "data", "audit.log"),
        "utf-8"
      ).trim();
      if (auditContent) {
        const lines = auditContent.split("\n");
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        if (lastEntry.tool_name === toolName) {
          tier = lastEntry.tier;
        }
      }
    } catch {
      /* no audit log */
    }

    // Only record if the user manually approved (not auto-approved, not denied)
    if (tier === "always_ask" || tier === "default") {
      let activeCtxName = "daily-life";
      try {
        const activeData = JSON.parse(
          readFileSync(join(root, "data", "active-context.json"), "utf-8")
        );
        activeCtxName = activeData.active_context;
      } catch {
        /* use default */
      }

      // Load preferences
      let prefs: PreferencesData = {};
      const prefsPath = join(root, "data", "preferences.json");
      try {
        prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
      } catch {
        /* start fresh */
      }

      if (!prefs[activeCtxName]) prefs[activeCtxName] = [];
      if (!Array.isArray(prefs[activeCtxName])) prefs[activeCtxName] = [];

      const { signature, description } = extractSignature(toolName, toolInput);
      const inputSummary = summarizeInput(toolInput);

      const existing = prefs[activeCtxName].find(
        (a) => a.tool === toolName && a.input_signature === signature
      );

      if (existing) {
        existing.count += 1;
        existing.recent_inputs.push(inputSummary);
        if (existing.recent_inputs.length > 5) {
          existing.recent_inputs = existing.recent_inputs.slice(-5);
        }
      } else {
        prefs[activeCtxName].push({
          tool: toolName,
          input_signature: signature,
          description,
          count: 1,
          recent_inputs: [inputSummary],
          learned_scope: null,
          learned_at: null,
        });
      }

      writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + "\n");
    }

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse" },
      })
    );
  } catch {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse" },
      })
    );
  }
}
