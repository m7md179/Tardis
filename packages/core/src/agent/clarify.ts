import type { ToolDefinition } from '@tardis/shared';

/**
 * Asking instead of guessing.
 *
 * A 4B model that is unsure does not hesitate — it commits. "I ate 2 sandwiches,
 * they cost me 2 JOD" lands in category `other` rather than `eating-out` because
 * nothing in the loop let it say "which category?". Every ambiguity resolves as
 * a confident wrong record, and a wrong record is worse than a question.
 *
 * This is a pseudo-tool: the agent loop intercepts it rather than routing it to
 * a plugin, ends the turn, and hands the question to the user as the reply. The
 * user's next message is an ordinary turn, so no extra state is carried between
 * them.
 *
 * The description is deliberately narrow. The failure mode to avoid is the
 * opposite one — a model that asks which category a coffee belongs to every
 * single time is unusable, so the tool is scoped to cases where guessing would
 * *write* something wrong, and explicitly ruled out where another tool could
 * answer instead.
 */
export const CLARIFY_TOOL_NAME = 'clarify';

export const CLARIFY_TOOL: ToolDefinition = {
  name: CLARIFY_TOOL_NAME,
  description:
    'Ask the user one short question, but only when the request is genuinely ambiguous AND ' +
    'guessing would record something wrong — an amount, a date, a category, or which of ' +
    'several items they mean. Do not use it to confirm something they already said, to ask ' +
    'permission, or for anything another tool can answer. Prefer acting when the answer is obvious.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'One specific question the user can answer in a few words. Not a list of questions.',
      },
    },
    required: ['question'],
  },
  actionType: 'direct',
  // Asking a question changes nothing, so it stays available in read-only mode
  // — which is the point: the alternative to asking is guessing.
  mutates: false,
};
