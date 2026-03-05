import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  GuardianContext,
  PolicyRule,
  PolicyResult,
  PreferencesData,
  ActiveContextData,
  ContextualApproval,
} from "./types.js";
import { extractSignature } from "./signatures.js";

function getRoot(): string {
  return process.env.ARBITER_HOME || join(import.meta.dirname, "..", "..");
}

function matchesPattern(value: string, pattern: string): boolean {
  const regex = new RegExp(pattern, "i");
  return regex.test(value);
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

export function evaluate(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: GuardianContext,
  preferences: ContextualApproval[]
): PolicyResult {
  const { policies } = context;

  // Tier 1: deny rules (hard block — learned preferences cannot override)
  for (const rule of policies.deny) {
    if (matchesRule(toolName, toolInput, rule)) {
      return { decision: "deny", reason: rule.reason, tier: "deny" };
    }
  }

  // Tier 2: contextual learned preferences (overrides always_ask)
  const sig = extractSignature(toolName, toolInput);
  for (const entry of preferences) {
    if (
      entry.learned_scope !== null &&
      entry.tool === toolName &&
      entry.input_signature === sig.signature
    ) {
      return {
        decision: "allow",
        reason: `Learned preference: ${entry.description} (${entry.learned_scope} scope)`,
        tier: "learned",
      };
    }
  }

  // Tier 3: always_ask rules
  for (const rule of policies.always_ask) {
    if (matchesRule(toolName, toolInput, rule)) {
      return { decision: "ask", reason: rule.reason, tier: "always_ask" };
    }
  }

  // Tier 4: auto_approve rules
  for (const rule of policies.auto_approve) {
    if (matchesRule(toolName, toolInput, rule)) {
      return { decision: "allow", reason: rule.reason, tier: "auto_approve" };
    }
  }

  // Tier 5: default — ask
  return {
    decision: "ask",
    reason: "No matching policy — asking for permission",
    tier: "default",
  };
}

export function loadActiveContext(): ActiveContextData {
  const path = join(getRoot(), "data", "active-context.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadContext(name: string): GuardianContext {
  const filename = name.toLowerCase().replace(/\s+/g, "-") + ".json";
  const path = join(getRoot(), "contexts", filename);
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadPreferences(): PreferencesData {
  const path = join(getRoot(), "data", "preferences.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}
