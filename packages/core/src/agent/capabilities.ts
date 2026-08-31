import type { PluginManifest } from '@tardis/shared';

/**
 * Answering "what can you do?" from the manifests, on every surface.
 *
 * ## Why the model cannot answer this itself
 *
 * Skill-based selection means the agent only ever sees the tools of the plugins
 * the router picked for *this* turn. Asked what it can do, it reports that
 * subset as if it were everything. Observed live:
 *
 *   > give me list of the plugins and tools you have
 *   (router loaded only `notes`)
 *   > notes.save-note, notes.get-note, … memory.save, memory.recall, clarify
 *   > so only notes and memory stuff?
 *   > That is the primary set of tools I have access to.
 *
 * Every word of that is true about what the model could see and false about
 * TARDIS. Widening selection does not fix it either — the honest answer is a
 * fact about the installed manifests, not a question for a language model, and
 * inventing a capability list is exactly the confident fiction this project
 * keeps having to guard against.
 *
 * So the question is intercepted before the agent loop and answered from the
 * manifests. This lives in core rather than in the Telegram bot because it used
 * to live in the Telegram bot: the web app, the mobile app and the terminal all
 * reach the agent through `runConversationTurn`, and none of them could
 * describe TARDIS at all.
 */

/** How much of the picture to give. */
export type CapabilityDetail = 'overview' | 'detail';

// ─── Recognising the question ────────────────────────────────────────────────
//
// The previous matcher was anchored to the start of the message and required
// almost exact phrasing. Against six real messages from one live conversation
// it matched **none**, while matching the textbook "what can you do":
//
//   "hola tardis, what are capable of"                    (greeting first, and no "you")
//   "give me list of the plugins and tools you have"
//   "can you give me there names and what they can do?"
//   "do you have any other tools? and if yes give me there names…"
//
// People do not open with the phrase a regex author had in mind. They say hello
// first, they typo, and they ask for "plugins" and "tools" by name.

/** "what can you do", anywhere in the sentence, with or without the "you". */
const ASKS_WHAT_YOU_DO =
  /\bwhat\s+(?:can|do|are)\s+(?:you\s+)?(?:do|able\s+to\s+do|capable\s+of|help\s+(?:me\s+)?with)\b/i;

/** The nouns that mean "your abilities" rather than anything in the world. */
const CAPABILITY_NOUN = /\b(?:tool|plugin|skill|command|capabilit|feature|function)(?:s|ies)?\b/i;

/** Marks the question as being about TARDIS rather than about the user. */
const ABOUT_YOU = /\b(?:you|your|yours|tardis)\b/i;

/** Marks it as being about the user's own things instead. */
const FIRST_PERSON = /\b(?:i|me|my|mine)\b/i;

/**
 * Shapes that make a message a question rather than an instruction.
 *
 * This is the guard against hijacking a real request. "add a note about the
 * plugins I want to build" mentions a capability noun and is *not* a question
 * about TARDIS; "do you have any other tools?" is.
 */
const QUESTION_SHAPE =
  /(?:\?|^\s*(?:what|which|how|do|does|can|could|are|is|list|show|tell|give)\b)/i;

/** A bare word that can only mean "explain yourself". */
const CAPABILITY_WORD =
  /^\s*\/?(?:help|commands?|capabilities|abilities|plugins?|skills?|tools?)\s*[?!.]*\s*$/i;

/**
 * Whether this message is asking what TARDIS can do.
 *
 * Deliberately broad. A false positive costs a helpful answer instead of a
 * conversational one; a false negative is the bug that produced the transcript
 * above. The one hard rule is that it must not hijack an *instruction* that
 * happens to mention a tool — hence the question-shape requirement.
 */
export function isCapabilityQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // "help", "/plugins", "commands?" — nothing else it could mean.
  if (CAPABILITY_WORD.test(t)) return true;

  // "help me log lunch" is a request. An earlier matcher on `help\b` hijacked
  // it, which is why the bare-word case above is anchored to the whole message.
  if (ASKS_WHAT_YOU_DO.test(t) && ABOUT_YOU.test(t)) return true;

  // "what are capable of" — the live typo. The phrase alone is enough when
  // nothing suggests it is about the user instead.
  if (ASKS_WHAT_YOU_DO.test(t) && !FIRST_PERSON.test(t)) return true;

  // "give me a list of the plugins and tools you have", "do you have any other
  // tools?" — a capability noun, phrased as a question, about TARDIS.
  //
  // "about TARDIS" is satisfied either by naming it, or by naming nobody:
  // "which plugins are loaded?" has no addressee and is unmistakably the same
  // question. What disqualifies a message is pointing at the *user* instead —
  // "what can I do with my budget?" is not this.
  if (!CAPABILITY_NOUN.test(t) || !QUESTION_SHAPE.test(t)) return false;
  return ABOUT_YOU.test(t) || !FIRST_PERSON.test(t);
}

/** Whether they asked for the summary or for the actual list. */
const WANTS_DETAIL =
  /\b(?:name|names|list|each|every|all\s+(?:the\s+)?(?:tool|plugin|skill)s?|detail|what\s+(?:they|each)\s+(?:can\s+)?do)\b|^\s*\/?(?:plugins?|skills?|tools?)\s*$/i;

export function capabilityDetail(text: string): CapabilityDetail {
  return WANTS_DETAIL.test(text.trim()) ? 'detail' : 'overview';
}

// ─── Composing the answer ────────────────────────────────────────────────────

/**
 * Plain text, no markup.
 *
 * Four surfaces render this — Telegram, web, mobile, terminal — and only one of
 * them parses Markdown. The Telegram path that already reached this answer
 * replied *without* `parse_mode`, so its asterisks showed up literally. Bullets
 * and dashes read correctly everywhere.
 */
const HIDDEN_PLUGINS = new Set(['test-plugin']);

/** Telegram rejects a message over 4096 characters outright. */
const MAX_ANSWER_CHARS = 3500;

function visible(manifests: PluginManifest[]): PluginManifest[] {
  return manifests.filter((m) => !HIDDEN_PLUGINS.has(m.name));
}

/**
 * A manifest's skills, defensively.
 *
 * Every manifest that goes through `PluginManifestSchema` has this array, but
 * "what can you do" is the one answer that must never throw — a crash here
 * leaves the user with no way to find out anything at all.
 */
function skillsOf(m: PluginManifest): PluginManifest['skills'] {
  return m.skills ?? [];
}

/** "budget.add-entry" → "add-entry". The plugin name is already the heading. */
function shortSkillName(id: string): string {
  return id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
}

/** First sentence only — a skill description is written for the model, not a menu. */
function firstSentence(text: string): string {
  const cut = text.match(/^.*?[.!?](?=\s|$)/);
  return (cut ? cut[0] : text).trim();
}

/**
 * @param needsSetup plugins whose required settings are unsatisfied. They are
 * hidden from the router — a capability that always fails is not one — so this
 * is the only place a person can find out they exist and why they are quiet.
 */
export function describeCapabilities(
  manifests: PluginManifest[],
  detail: CapabilityDetail = 'overview',
  needsSetup: ReadonlySet<string> = new Set()
): string {
  const plugins = visible(manifests);
  const setupNote = (m: PluginManifest): string =>
    needsSetup.has(m.name) ? '  — needs setup before I can use it' : '';

  if (plugins.length === 0) {
    // Truthful rather than reassuring: with no plugins the AI can do nothing at
    // all, because it can only act through them.
    return 'No plugins are loaded, so there is nothing I can do for you yet.';
  }

  const totalSkills = plugins.reduce((n, m) => n + skillsOf(m).length, 0);

  if (detail === 'overview') {
    return [
      `I can do ${totalSkills} things, across ${plugins.length} plugins:`,
      '',
      ...plugins.map((m) => `• ${m.displayName} — ${firstSentence(m.summary)}${setupNote(m)}`),
      '',
      'You do not need commands — just say what happened:',
      '  "I had two eggs and toast"',
      '  "spent 4.5 on coffee"',
      '  "remind me to call the bank in an hour"',
      '  "how much have I spent this month?"',
      '',
      'Ask for "the full list" and I will name every skill.',
    ].join('\n');
  }

  const blocks = plugins.map((m) => {
    const skills = skillsOf(m).map(
      (s) => `  • ${shortSkillName(s.id)} — ${firstSentence(s.description)}`
    );
    return [`${m.displayName} (${m.name}) — ${skills.length} skills${setupNote(m)}`, ...skills].join(
      '\n'
    );
  });

  const full = [`${totalSkills} skills across ${plugins.length} plugins:`, '', ...blocks].join('\n\n');
  if (full.length <= MAX_ANSWER_CHARS) return full;

  // Too long to send. Naming every plugin and its count is still a complete
  // answer to "what can you do"; silently dropping half of it would not be.
  return [
    `${totalSkills} skills across ${plugins.length} plugins:`,
    '',
    ...plugins.map(
      (m) =>
        `• ${m.displayName} (${m.name}) — ${skillsOf(m).length} skills${setupNote(m)}: ${skillsOf(m)
          .map((s) => shortSkillName(s.id))
          .join(', ')}`
    ),
    '',
    'Ask about any one of these by name and I will explain what it does.',
  ].join('\n');
}
