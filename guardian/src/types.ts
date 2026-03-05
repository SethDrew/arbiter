// Guardian: Adaptive Permission System — Shared Types

export interface PolicyRule {
  tool_pattern: string;
  input_pattern?: string;
  reason: string;
}

export interface ContextPolicies {
  auto_approve: PolicyRule[];
  always_ask: PolicyRule[];
  deny: PolicyRule[];
}

export interface GuardianContext {
  name: string;
  description: string;
  policies: ContextPolicies;
  audit_level: "minimal" | "standard" | "full";
  behavior_notes: string[];
}

export type PolicyDecision = "allow" | "deny" | "ask";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
  tier: "deny" | "always_ask" | "auto_approve" | "learned" | "default";
}

export interface ActiveContextData {
  active_context: string;
  switched_at: string;
}

export interface ContextualApproval {
  tool: string;
  input_signature: string;
  description: string;
  count: number;
  recent_inputs: string[];
  learned_scope: null | "context" | "global";
  learned_at: string | null;
}

export interface PreferencesData {
  [contextName: string]: ContextualApproval[];
}

export interface AuditEntry {
  timestamp: string;
  context: string;
  tool_name: string;
  tool_input_summary: string;
  decision: PolicyDecision;
  reason: string;
  tier: string;
}

export interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface HookOutput {
  hookSpecificOutput?: {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}
