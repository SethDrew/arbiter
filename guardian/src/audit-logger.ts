import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry, PolicyDecision } from "./types.js";

function getRoot(): string {
  return process.env.ARBITER_HOME || join(import.meta.dirname, "..", "..");
}
function getAuditPath(): string {
  return join(getRoot(), "data", "audit.log");
}

export function createAuditEntry(
  context: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  decision: PolicyDecision,
  reason: string,
  tier: string
): AuditEntry {
  let summary: string;
  if (typeof toolInput.command === "string") {
    summary = toolInput.command.slice(0, 120);
  } else if (typeof toolInput.file_path === "string") {
    summary = toolInput.file_path;
  } else if (typeof toolInput.pattern === "string") {
    summary = `pattern: ${toolInput.pattern}`;
  } else if (typeof toolInput.url === "string") {
    summary = toolInput.url;
  } else {
    summary = JSON.stringify(toolInput).slice(0, 120);
  }

  return {
    timestamp: new Date().toISOString(),
    context,
    tool_name: toolName,
    tool_input_summary: summary,
    decision,
    reason,
    tier,
  };
}

export function logAction(entry: AuditEntry): void {
  appendFileSync(getAuditPath(), JSON.stringify(entry) + "\n");
}

export function readRecentAudit(count: number = 20): AuditEntry[] {
  const p = getAuditPath();
  if (!existsSync(p)) return [];
  const content = readFileSync(p, "utf-8").trim();
  if (!content) return [];
  const lines = content.split("\n");
  return lines
    .slice(-count)
    .map((line) => JSON.parse(line) as AuditEntry)
    .reverse();
}
