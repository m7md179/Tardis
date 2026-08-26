# TARDIS Hybrid UI Contract

**Status:** Phase C spec. Derived from the 26 real skills across the five working
plugins — not invented abstractly. See `SKILLS.md` for the Skill model itself.

Every Skill may declare a `ui` descriptor. A client reads `GET /api/skills` and renders
from that descriptor alone: **no client ever hardcodes per-plugin knowledge.** The same
descriptor drives mobile, web and TUI.

---

## 1. Where the vocabulary came from

Grouping the real skill signatures by shape, rather than guessing:

| Observed shape | Real examples | Block |
|---|---|---|
| No arguments, run and show the result | `reminders.list-reminders`, `time-tracker.status`, `google-calendar.setup-oauth` | `action` |
| Arguments in, one submit | `set-reminder`, `save-note`, `add-task`, `create-event`, `check-schedule` | `form` |
| Returns a collection to browse | `list-notes`, `list-tasks`, `list-events`, `history` | `list` |
| Operates on one item of a collection | `complete-task`, `cancel-reminder`, `delete-note`, `stop`/`pause`/`resume` | `list.actions` |
| Something counting down or up | `set-reminder` (fires at), `time-tracker.status` (elapsed) | `timer` |
| One record shown in full | `notes.get-note` | `detail` |

Five blocks cover all 26. The things that looked like separate blocks are not:

- A **text editor** (notes) is a `form` with a `textarea` field.
- A **date/time picker** (calendar) is a `form` with `date` and `time` fields.
- A **checkbox/complete action** (todoist) is a `list` item action.

Keeping those as field types rather than blocks is what stops the vocabulary growing once
per plugin — the failure mode this contract exists to prevent.

---

## 2. The five blocks

```jsonc
"ui": {
  "block": "action" | "form" | "list" | "timer" | "detail",
  "label": "Set reminder",        // required — what the surface calls this
  "icon": "alarm",                // optional semantic name, never a file path
  // …block-specific keys below
}
```

### `action`
A single button. Runs the skill, shows the result.
```jsonc
{ "block": "action", "label": "Current status", "args": {} }
```

### `form`
Fields, then submit. Fields are **derived from the skill's `parameters` JSON Schema** by
default; declare `fields` only to override order, labels, or widget choice.
```jsonc
{
  "block": "form",
  "label": "Set reminder",
  "submitLabel": "Set",
  "fields": [
    { "name": "message",      "type": "text",   "label": "Remind me to" },
    { "name": "delayMinutes", "type": "number", "label": "In (minutes)", "min": 1 }
  ]
}
```

**Field types:** `text`, `textarea`, `number`, `date`, `time`, `datetime`, `select`,
`tags`, `checkbox`, `image`. Every surface must implement all of them — a TUI renders
`date` as a validated text input, which is a rendering choice, not an excuse to skip it.

`image` submits a **data URI**, the same shape `PluginAPI.llm.analyzeImage` expects. A
surface with a camera offers one; a surface without falls back to a file picker; the TUI
cannot capture an image at all and must render the field as unavailable rather than
pretending. A skill whose only input is an `image` is therefore legitimately unusable from
a terminal — that is a property of the capability, not a gap in the contract.

### `list`
A collection, with optional per-item actions.
```jsonc
{
  "block": "list",
  "label": "Tasks",
  "resultPath": "tasks",              // where the array sits in the handler result
  "emptyText": "No tasks.",
  "item": { "id": "id", "title": "content", "subtitle": "due" },
  "actions": [
    {
      "skill": "todoist.complete-task",
      "label": "Complete",
      "style": "primary",             // primary | secondary | danger
      "args": { "taskName": "content" }   // skill param  <-  item field
    }
  ]
}
```
`args` maps a **skill parameter name** to a **field on the selected item**. That indirection
is what lets a client invoke an item action without knowing what the plugin does.

### `timer`
Something counting down or up.
```jsonc
{
  "block": "timer",
  "label": "Pending reminders",
  "mode": "countdown",                // countdown → uses `deadline`; elapsed → uses `since`
  "resultPath": "reminders",
  "item": { "id": "id", "title": "message", "deadline": "fireAt" }
}
```
For `mode: "elapsed"` the item uses `since` (a start timestamp) and optional `accumulated`
(seconds already banked) — which is exactly how `time-tracker` stores a paused session.

### `detail`
One record, shown in full.
```jsonc
{
  "block": "detail",
  "label": "Note",
  "item": { "title": "title", "body": "content", "meta": ["tags", "updatedAt"] }
}
```

---

## 3. The escape hatch, and its hard requirement

A Skill **may** ship bespoke UI for surfaces that can run code:

```jsonc
"ui": {
  "block": "form",                       // ← the fallback. NOT optional.
  "label": "Log a meal",
  "fields": [ /* … */ ],
  "custom": {
    "mobile": "screens/MealLogger.tsx",
    "web":    "screens/MealLogger.tsx"
  }
}
```

**A descriptor carrying `custom` MUST still carry a complete standard-block fallback.**
This is enforced in the schema (`SkillUiDescriptorSchema` rejects `custom` without a valid
`block`), not left to reviewer discipline — because the failure mode is silent: the first
plugin to ship custom-only UI breaks the TUI, and nobody notices until someone opens a
terminal.

Surfaces choose per skill:

| Surface | Behaviour |
|---|---|
| mobile | `custom.mobile` if present, else the standard block |
| web | `custom.web` if present, else the standard block |
| **TUI** | **always the standard block** — it cannot execute custom code |

A client that cannot resolve a `custom` entry falls back silently. Custom UI is an
enhancement; the standard block is the contract.

---

## 4. Rules

1. **Descriptors are declarative data.** No expressions, no code, no URLs to fetch. A
   descriptor is JSON that survives `GET /api/skills`.
2. **`parameters` stays the single argument contract.** `fields` may relabel or reorder,
   never introduce a parameter the skill does not accept.
3. **`ui` is optional.** A skill without one is AI-only; clients simply do not surface it.
   `aiInvocable: false` with no `ui` is a contradiction and is worth flagging in review.
4. **`workflow` skills render with confirmation.** The client must show the approval step;
   `POST /api/skills/:id/invoke` returns `APPROVAL_REQUIRED` regardless, so a client that
   forgets cannot accidentally destroy anything.
5. **Unknown block or field type → skip and log.** A client must never crash on a
   descriptor from a newer server than itself.
