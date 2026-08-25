# TARDIS Skills Architecture

**Status:** Phase B spec. Written before implementation, per the build plan.

A **Plugin** is the deployable container. A **Skill** is one capability it registers.
Everything a plugin can *do* is a Skill; the plugin itself is packaging — storage,
permissions, config, lifecycle, hooks.

---

## 1. The name collision, resolved

The codebase already had a "Skill Router", and it meant something different from the
Skill concept introduced here. Leaving both would have been genuinely confusing, so the
old name is gone rather than overloaded.

| Before | After | What it actually is |
|---|---|---|
| `SkillRouter` (`agent/skill-router.ts`) | `PluginRouter` (`agent/plugin-router.ts`) | Picks which **plugins** are relevant to a message, before the agent loop runs |
| `selectPluginSkills()` | `selectPlugins()` | The selection call |
| `SkillSelectionResult` | `PluginSelectionResult` | Its return type |
| `PluginManager.getSkillSummaries()` | `getPluginSummaries()` | Plugin-level cards for the router |
| manifest `skillSummary` | manifest `summary` | One-line plugin blurb the router selects on |
| manifest `tools[]` | manifest `skills[]` | **This was already the Skill concept** |

The old router never routed among capabilities — it routed among plugins, using a
plugin-level blurb. It is now named for what it does.

`skillSummary` and `tools` are still **accepted as deprecated aliases** so no manifest
breaks on load. All in-repo plugins are migrated to the new names in this phase.

---

## 2. What a Skill is

```jsonc
{
  "id": "reminders.set-reminder",     // "<plugin>.<skill>", globally unique
  "description": "Set a reminder to be delivered after a delay.",
  "aiInvocable": true,                 // may the agent loop call this as a tool?
  "actionType": "direct",              // "direct" = auto-run, "workflow" = needs approval
  "parameters": {                      // JSON Schema — one contract for AI *and* UI
    "type": "object",
    "properties": {
      "message":      { "type": "string", "description": "What to remind about" },
      "delayMinutes": { "type": "number", "description": "Minutes from now" }
    },
    "required": ["message", "delayMinutes"]
  },
  "permissions": ["notifications:send"],  // optional, additive to the plugin's grants
  "ui": { /* uiDescriptor — vocabulary defined in Phase C / UI-CONTRACT.md */ }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `plugin.skill`, matches `^[a-z0-9-]+\.[a-z0-9-]+$`. Same format as today's tool names, so nothing renames. |
| `description` | yes | Human- and model-readable. Doubles as the AI tool description. |
| `aiInvocable` | no (default `true`) | `false` = the agent loop never sees it; reachable only by direct invocation. |
| `actionType` | no (default `direct`) | Unchanged semantics. Users may promote `direct`→`workflow`, never the reverse. |
| `parameters` | yes | JSON Schema. The **single** argument contract — the LLM and the UI bind to the same shape. |
| `permissions` | no | Additive to the plugin's. Enforcement is the existing guard; nothing new. |
| `ui` | no | How a client renders/invokes this without an LLM. Phase C. |

### `aiInvocable: false` earns its place

Some capabilities should never be LLM-reachable: a raw toggle, a destructive
administrative action, something whose natural-language framing is ambiguous enough to be
dangerous. Marking it `false` keeps it out of every prompt — which also keeps it out of
the token budget — while leaving it fully usable from a button.

This is only meaningful because Skills are **directly invocable** (§4). Without that,
`aiInvocable: false` would define an unreachable capability.

---

## 3. Relationship to tools

Skills are the source of truth. The agent loop still consumes `ToolDefinition[]`, which is
now **derived**:

```
tools = skills
  .filter(s => s.aiInvocable)
  .map(s => ({ name: s.id, description, parameters, actionType }))
```

A legacy `tools[]` entry normalizes to a Skill with `id = name` and `aiInvocable = true`,
so old and new manifests produce identical agent-loop behaviour.

Consequence worth stating plainly: **the prompt shrinks as skills opt out.** Tool schemas
are the dominant fixed prompt cost (~1,121 tokens for 15 tools, ~78% of fixed overhead),
so `aiInvocable: false` is a real token lever, not just organisation.

---

## 4. API surface

### `GET /api/skills`

Every registered Skill across all loaded plugins. This is what every client — mobile, web,
TUI — renders from. Clients never hardcode per-plugin knowledge.

```jsonc
{
  "skills": [
    {
      "id": "reminders.set-reminder",
      "plugin": "reminders",
      "pluginDisplayName": "Reminders",
      "description": "Set a reminder to be delivered after a delay.",
      "aiInvocable": true,
      "actionType": "direct",
      "parameters": { "type": "object", "properties": { /* … */ } },
      "ui": { /* uiDescriptor or null */ }
    }
  ]
}
```

Query params: `?plugin=reminders` and `?aiInvocable=false` for filtering.

### `POST /api/skills/:id/invoke`

Executes a Skill directly, with **no LLM involved**.

```jsonc
// request
{ "args": { "message": "go on a walk", "delayMinutes": 5 } }

// response
{ "success": true, "data": { /* handler return value */ } }
{ "success": false, "error": "…", "code": "VALIDATION_ERROR" }
```

Included in Phase B deliberately, though the plan named only `GET`: a discovery endpoint
with no way to act is not a usable contract, `aiInvocable: false` is unreachable without
it, and Phase D's gate (an action in the app producing a real database change) depends on
it. It reuses `ToolRouter`, so validation, permissions and error codes are the exact same
path the agent loop takes — direct invocation is not a second, weaker door.

`workflow` skills still require approval: invoking one returns
`{ success: false, code: 'APPROVAL_REQUIRED', preview }` rather than executing.

---

## 5. Handlers

Unchanged. A plugin exports `executeTool(name, args)` and switches on the name; that
function *is* the handler dispatch and already matches this model. Skills add declaration,
not a new execution mechanism.

---

## 6. What this phase does not decide

- The `ui` block vocabulary — Phase C (`UI-CONTRACT.md`). Phase B only guarantees the
  field survives from manifest to `GET /api/skills` untouched.
- Any client rendering — Phase D.
