import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PreferencesData, ContextualApproval } from "./types.js";
import { extractSignature } from "./signatures.js";

function getRoot(): string {
  return process.env.ARBITER_HOME || join(import.meta.dirname, "..", "..");
}
function getPrefsPath(): string {
  return join(getRoot(), "data", "preferences.json");
}
const MAX_RECENT = 5;
const SUGGESTION_THRESHOLD = 3;

export function loadPreferences(): PreferencesData {
  const p = getPrefsPath();
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function savePreferences(data: PreferencesData): void {
  writeFileSync(getPrefsPath(), JSON.stringify(data, null, 2) + "\n");
}

export function recordContextualApproval(
  contextName: string,
  toolName: string,
  toolInput: Record<string, unknown>
): void {
  const prefs = loadPreferences();
  if (!prefs[contextName]) prefs[contextName] = [];

  const { signature, description } = extractSignature(toolName, toolInput);

  // Summarize the input for recent_inputs
  let inputSummary: string;
  if (typeof toolInput.command === "string") inputSummary = toolInput.command.slice(0, 80);
  else if (typeof toolInput.file_path === "string") inputSummary = toolInput.file_path;
  else if (typeof toolInput.url === "string") inputSummary = toolInput.url;
  else inputSummary = JSON.stringify(toolInput).slice(0, 80);

  const existing = prefs[contextName].find(
    (a) => a.tool === toolName && a.input_signature === signature
  );

  if (existing) {
    existing.count += 1;
    existing.recent_inputs.push(inputSummary);
    if (existing.recent_inputs.length > MAX_RECENT) {
      existing.recent_inputs = existing.recent_inputs.slice(-MAX_RECENT);
    }
  } else {
    prefs[contextName].push({
      tool: toolName,
      input_signature: signature,
      description,
      count: 1,
      recent_inputs: [inputSummary],
      learned_scope: null,
      learned_at: null,
    });
  }

  savePreferences(prefs);
}

export function confirmLearning(
  contextName: string,
  tool: string,
  inputSignature: string,
  scope: "context" | "global",
  description?: string
): void {
  const prefs = loadPreferences();
  if (!prefs[contextName]) prefs[contextName] = [];

  const existing = prefs[contextName].find(
    (a) => a.tool === tool && a.input_signature === inputSignature
  );

  if (existing) {
    existing.learned_scope = scope;
    existing.learned_at = new Date().toISOString();
    if (description) existing.description = description;
  } else {
    prefs[contextName].push({
      tool,
      input_signature: inputSignature,
      description: description || `Using ${tool} (${inputSignature})`,
      count: 0,
      recent_inputs: [],
      learned_scope: scope,
      learned_at: new Date().toISOString(),
    });
  }

  savePreferences(prefs);
}

export interface PreferenceSuggestion {
  tool: string;
  inputSignature: string;
  description: string;
  count: number;
  recentInputs: string[];
}

export function getPreferenceSuggestions(
  contextName: string
): PreferenceSuggestion[] {
  const prefs = loadPreferences();
  const ctxPrefs: ContextualApproval[] = prefs[contextName] || [];
  const suggestions: PreferenceSuggestion[] = [];

  for (const entry of ctxPrefs) {
    if (entry.learned_scope === null && entry.count >= SUGGESTION_THRESHOLD) {
      suggestions.push({
        tool: entry.tool,
        inputSignature: entry.input_signature,
        description: entry.description,
        count: entry.count,
        recentInputs: entry.recent_inputs,
      });
    }
  }

  return suggestions.sort((a, b) => b.count - a.count);
}

export function isLearned(
  contextName: string,
  toolName: string,
  inputSignature: string
): boolean {
  const prefs = loadPreferences();

  // Check context-specific learned preferences
  const ctxPrefs: ContextualApproval[] = prefs[contextName] || [];
  for (const entry of ctxPrefs) {
    if (
      entry.tool === toolName &&
      entry.input_signature === inputSignature &&
      entry.learned_scope !== null
    ) {
      return true;
    }
  }

  // Check global learned preferences across all contexts
  for (const [ctx, entries] of Object.entries(prefs)) {
    if (ctx === contextName) continue;
    for (const entry of entries) {
      if (
        entry.tool === toolName &&
        entry.input_signature === inputSignature &&
        entry.learned_scope === "global"
      ) {
        return true;
      }
    }
  }

  return false;
}
