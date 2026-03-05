# Arbiter — Development

Adaptive permission governance for AI coding assistants. Distributed as an npm package (`arbiter`).

## Architecture

- **`guardian/src/`** — Core policy engine (TypeScript). Contexts, preferences, audit, signatures.
- **`src/`** — CLI layer. Entry point (`cli.ts`) and commands (`serve`, `hook`, `init`, `doctor`).
- **`templates/`** — Default contexts and CLAUDE.md personality shipped with the package.
- **`partner-env/`** — Integration test environment. Simulates what a user's machine looks like after `arbiter init`.
- **`dist/arbiter.js`** — Single bundled file (esbuild). This is what ships in the npm package.

## Building

```bash
npm run build          # esbuild bundles src/ + guardian/src/ → dist/arbiter.js
npm run build:guardian # tsc compiles guardian/src/ → guardian/dist/ (for dev)
npm run build:all      # both
```

## Testing

```bash
# Test the CLI
node dist/arbiter.js help
node dist/arbiter.js doctor

# Test hooks with simulated input
echo '{"tool_name":"Read","tool_input":{"file_path":"/tmp/test"}}' | \
  ARBITER_HOME=partner-env node dist/arbiter.js hook pre-tool-use

# Test the full partner experience
cd partner-env && claude
```

## Key files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (arbiter serve/hook/init/doctor) |
| `src/commands/serve.ts` | MCP server (tools: arbiter_get_status, arbiter_learn_preference, etc.) |
| `src/commands/hook.ts` | PreToolUse + PostToolUse hook handlers |
| `src/commands/init.ts` | Setup wizard for new users |
| `src/commands/doctor.ts` | Diagnostics |
| `guardian/src/policy-engine.ts` | Policy evaluation (deny → learned → always_ask → auto_approve → default) |
| `guardian/src/signatures.ts` | Input signature extraction (command → pattern matching) |
| `guardian/src/preference-tracker.ts` | Contextual approval tracking and learning |
| `partner-env/` | Integration test environment |
| `templates/` | Default contexts and personality for `arbiter init` |

## ARBITER_HOME

The CLI sets `ARBITER_HOME` to `~/.arbiter/` by default. All data (contexts, preferences, audit log) lives there. Override with env var for testing: `ARBITER_HOME=partner-env node dist/arbiter.js ...`

## Publishing

```bash
npm run build
npm publish
```

The `files` field in package.json ensures only `dist/arbiter.js` and `templates/` are included.
