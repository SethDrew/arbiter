# Architecture Decision Record Guide

The decision log (`design/decisions.yaml`) is the permanent record of all design
choices, trade-offs, rejected alternatives, and future directions for this project.

This tracks **how we think about the system** — not what we built.

## What Belongs Here

**Log these:**
- Design choices with reasoning: "Hooks over middleware because hooks are decoupled from the MCP server"
- Trade-offs considered: "Flat signatures are fast but can't reason about intent"
- Rejected alternatives with *why*: "Path A was too mechanical for semantic actions"
- Future directions worth revisiting: "Intent-based approval chains once the system matures"
- Constraints that shape design: "Hooks are standalone .mjs — can't import compiled TS"

**Don't log these:**
- Bug fixes, refactors, or implementation details (that's git)
- Configuration changes or dependency bumps
- Anything that's better as a code comment

**Rule of thumb:** If it changes how we *think* about the system's shape — log it.
If it's something we *did* to the code — that's what git is for.

## Entry Format

```yaml
- id: kebab-case-unique-id
  date: 2026-02-28             # when first discussed
  touched: 2026-02-28          # when last revisited
  title: Short descriptive title
  summary: >
    1-3 sentences. The core decision and why.
  status: accepted              # see vocabulary below
  impact: high                  # how much this shapes the system: high | medium | low
  confidence: high              # how sure we are this is right: high | medium | low
  alternatives: []              # other approaches considered
  tags: [relevant, tags]
  relates_to: [other-entry-ids]
  notes: >
    Context, caveats, what would make us revisit this.
```

## Status Vocabulary

| Status | Meaning |
|--------|---------|
| `proposed` | Under consideration, not yet decided |
| `accepted` | Decision made, implementation planned or in progress |
| `implemented` | Built and working in the codebase |
| `deferred` | Good idea, not yet — revisit when conditions change |
| `superseded` | Replaced by a better approach (link to replacement) |
| `rejected` | Considered and dismissed with reasoning |

## Impact vs Confidence

Independent axes. Something can be:
- **High impact, low confidence**: Big decision we're not sure about — watch closely
- **Low impact, high confidence**: Small and obvious — just do it
- **High both**: Core architectural pillars
- **Low both**: Noted for completeness, not driving anything

## Adding Entries

Edit `decisions.yaml` directly. Before adding, check: is this new, or should it
update an existing entry?

To UPDATE an existing entry, edit it in place — change the `touched` date and
whatever fields changed. Add a line to `notes` explaining what changed and why.

## Common Tags

Add new ones freely. Currently in use:
- **System areas**: `guardian`, `hooks`, `mcp`, `permissions`, `learning`
- **Patterns**: `architecture`, `data-model`, `evaluation-order`, `ux`
- **Status**: `future`, `trade-off`, `constraint`

## Searching

```
Grep pattern="deferred" path="design/decisions.yaml"
Grep pattern="tags:.*guardian" path="design/decisions.yaml"
```
