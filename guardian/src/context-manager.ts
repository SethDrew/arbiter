import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GuardianContext, ActiveContextData } from "./types.js";

function getRoot(): string {
  return process.env.ARBITER_HOME || join(import.meta.dirname, "..", "..");
}
function getContextsDir(): string {
  return join(getRoot(), "contexts");
}
function getActivePath(): string {
  return join(getRoot(), "data", "active-context.json");
}

function contextFilename(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-") + ".json";
}

export function getActiveContext(): ActiveContextData {
  return JSON.parse(readFileSync(getActivePath(), "utf-8"));
}

export function setActiveContext(name: string): void {
  const filename = contextFilename(name);
  const path = join(getContextsDir(), filename);
  if (!existsSync(path)) {
    throw new Error(`Context "${name}" not found (looked for ${filename})`);
  }
  const data: ActiveContextData = {
    active_context: name,
    switched_at: new Date().toISOString(),
  };
  writeFileSync(getActivePath(), JSON.stringify(data, null, 2) + "\n");
}

export function listContextNames(): string[] {
  const dir = getContextsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const ctx: GuardianContext = JSON.parse(
        readFileSync(join(dir, f), "utf-8")
      );
      return ctx.name;
    });
}

export function loadContext(name: string): GuardianContext {
  const filename = contextFilename(name);
  const path = join(getContextsDir(), filename);
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadAllContexts(): GuardianContext[] {
  const dir = getContextsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

export function saveContext(context: GuardianContext): void {
  const filename = contextFilename(context.name);
  const path = join(getContextsDir(), filename);
  writeFileSync(path, JSON.stringify(context, null, 2) + "\n");
}

export function createContext(
  name: string,
  description: string,
  cloneFrom?: string
): GuardianContext {
  const filename = contextFilename(name);
  const path = join(getContextsDir(), filename);
  if (existsSync(path)) {
    throw new Error(`Context "${name}" already exists`);
  }

  let context: GuardianContext;
  if (cloneFrom) {
    context = loadContext(cloneFrom);
    context.name = name;
    context.description = description;
  } else {
    context = {
      name,
      description,
      policies: { auto_approve: [], always_ask: [], deny: [] },
      audit_level: "standard",
      behavior_notes: [],
    };
  }

  saveContext(context);
  return context;
}
