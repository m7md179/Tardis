/**
 * The published OpenAPI 3.1 description of the TARDIS HTTP API.
 *
 * ## Why this is hand-written
 *
 * The obvious approach is `@hono/zod-openapi`, which derives the document from
 * the route definitions and so cannot drift. Adopting it means rewriting all 28
 * routes through `createRoute()` — including the SSE stream and the auth
 * middleware — which is a large, risky diff in working code, in service of a
 * documentation feature.
 *
 * The reason a generated document is better is that a hand-written one rots.
 * That specific problem is solved directly instead: Hono exposes its route
 * table as `app.routes`, and `openapi.test.ts` asserts that the document and
 * the table describe exactly the same set of endpoints. A route added without a
 * description fails the build, which is the guarantee the generator was for.
 *
 * The bit still on trust is the *shape* of each request and response, and that
 * is what the endpoint tests already cover.
 */

export interface OpenApiInfo {
  version: string;
  serverUrl?: string | undefined;
}

const ERROR = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
  },
  required: ['error'],
} as const;

const AGENT_STEP = {
  type: 'object',
  description: 'One entry in a turn ledger — a thought, a tool call, or its result.',
  properties: {
    type: {
      type: 'string',
      enum: ['reasoning', 'tool_call', 'tool_result', 'approval_request', 'user_response', 'error'],
    },
    content: { type: 'string' },
    toolName: { type: 'string' },
    toolArgs: { type: 'object', additionalProperties: true },
    toolResult: {},
    timestamp: { type: 'integer' },
    durationMs: { type: 'integer' },
  },
  required: ['type', 'content', 'timestamp'],
} as const;

const CONFIG_FIELD = {
  type: 'object',
  description: 'One plugin setting, described well enough to render a form for it.',
  properties: {
    type: { type: 'string', enum: ['string', 'number', 'boolean', 'select'] },
    label: { type: 'string' },
    description: { type: 'string' },
    default: {},
    required: { type: 'boolean' },
    secret: {
      type: 'boolean',
      description:
        'Masked in responses. Presentation only — the value is stored in config.json in the clear.',
    },
    min: { type: 'number' },
    max: { type: 'number' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { value: {}, label: { type: 'string' } },
        required: ['value', 'label'],
      },
    },
  },
  required: ['type', 'label'],
} as const;

const SKILL = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'budget.add-entry' },
    plugin: { type: 'string' },
    pluginDisplayName: { type: 'string' },
    description: { type: 'string' },
    aiInvocable: { type: 'boolean' },
    actionType: {
      type: 'string',
      enum: ['direct', 'workflow'],
      description: 'How much ceremony the skill needs: run it, or ask first.',
    },
    mutates: {
      type: 'boolean',
      description:
        'Whether running it changes anything. A separate axis from actionType, and the one read-only mode needs.',
    },
    parameters: { type: 'object', additionalProperties: true },
    ui: { type: ['object', 'null'], additionalProperties: true },
  },
  required: ['id', 'plugin', 'description', 'actionType', 'parameters'],
} as const;

const TURN = {
  type: 'object',
  description: 'One exchange: the question, the work, the answer.',
  properties: {
    id: { type: 'string' },
    at: { type: 'integer', description: 'Epoch ms of the user message.' },
    question: { type: 'string' },
    steps: { type: 'array', items: AGENT_STEP },
    answer: { type: ['string', 'null'] },
  },
  required: ['id', 'at', 'question', 'steps'],
} as const;

/**
 * A reference to a named component.
 *
 * Referencing rather than inlining is what makes a generated client produce
 * `AgentStep` and `Turn` as named types instead of a fresh anonymous shape per
 * endpoint — the difference between a usable SDK and a pile of structs.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonBody = (schema: unknown, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

const jsonResponse = (description: string, schema?: unknown) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});

const errorResponse = (description: string) => jsonResponse(description, ref('Error'));

/**
 * Every authed operation can return this. A generated client with no 401 case
 * reports an expired token as an unexplained failure.
 */
const UNAUTHORIZED = errorResponse('Missing or invalid bearer token');

const query = (name: string, schema: unknown, description: string) => ({
  name,
  in: 'query',
  schema,
  description,
});

const path = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description,
});

/**
 * Builds the document. Takes the version so it never disagrees with the running
 * build, and an optional server URL for a generated client's base path.
 */
export function buildOpenApiDocument(info: OpenApiInfo): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'TARDIS',
      version: info.version,
      description:
        'A self-hosted assistant. The AI acts only through plugin skills; this API exposes the same pipeline every surface uses.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    ...(info.serverUrl ? { servers: [{ url: info.serverUrl }] } : {}),
    tags: [
      { name: 'auth', description: 'Getting a token, and checking TARDIS is up.' },
      { name: 'chat', description: 'The agent loop, the way every client reaches it.' },
      { name: 'skills', description: 'Invocable capabilities, and how to render them.' },
      { name: 'plugins', description: 'What is installed, and how it is configured.' },
      { name: 'memory', description: 'What TARDIS remembers between conversations.' },
      { name: 'proactive', description: 'Scheduled work TARDIS starts on its own.' },
      { name: 'traces', description: 'What the agent actually did, step by step.' },
      { name: 'config', description: 'Which model TARDIS runs, and how to reach it.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: ERROR,
        AgentStep: AGENT_STEP,
        Turn: TURN,
        Skill: SKILL,
        PluginConfigField: CONFIG_FIELD,
      },
    },
    // Everything except /api/health and /api/auth/login, which the JWT
    // middleware skips explicitly.
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'checkHealth',
          tags: ['auth'],
          summary: 'Liveness check',
          security: [],
          responses: {
            '200': jsonResponse('TARDIS is up', {
              type: 'object',
              properties: { status: { type: 'string' }, timestamp: { type: 'integer' } },
              required: ['status', 'timestamp'],
            }),
          },
        },
      },

      '/api/auth/login': {
        post: {
          operationId: 'login',
          tags: ['auth'],
          summary: 'Exchange the admin password for a JWT',
          security: [],
          requestBody: jsonBody({
            type: 'object',
            properties: { password: { type: 'string' } },
            required: ['password'],
          }),
          responses: {
            '200': jsonResponse('A bearer token', {
              type: 'object',
              properties: { token: { type: 'string' } },
              required: ['token'],
            }),
            '400': errorResponse('No password supplied'),
            '401': errorResponse('Wrong password'),
            '429': errorResponse('Too many attempts — the login limiter is deliberately strict'),
          },
        },
      },

      '/api/chat': {
        post: {
          operationId: 'sendMessage',
          tags: ['chat'],
          summary: 'Run one conversation turn',
          description:
            'The same pipeline Telegram uses: plugin selection, memory retrieval, the agent loop, then trace and history persistence.',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              message: { type: 'string' },
              chatId: {
                type: 'string',
                default: 'web',
                description:
                  'Which conversation this belongs to. Web, mobile and the terminal share "app".',
              },
              images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Data URIs. At most one reaches the model.',
              },
            },
            required: ['message'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('The answer, with the ledger that produced it', {
              type: 'object',
              properties: {
                response: { type: 'string' },
                selectedPlugins: { type: 'array', items: { type: 'string' } },
                traceId: { type: 'string' },
                steps: { type: 'array', items: ref('AgentStep') },
                pendingApproval: {
                  type: 'object',
                  description:
                    'Present when the turn paused for approval. Confirming is Telegram-only for now.',
                  properties: {
                    toolName: { type: 'string' },
                    args: { type: 'object', additionalProperties: true },
                    preview: { type: 'string' },
                  },
                },
              },
              required: ['response', 'selectedPlugins', 'traceId', 'steps'],
            }),
            '400': errorResponse('Missing or unparseable body'),
            '503': errorResponse('This instance has no conversation pipeline configured'),
          },
        },
      },

      '/api/chat/stream': {
        post: {
          operationId: 'streamMessage',
          tags: ['chat'],
          summary: 'Run one conversation turn, streaming progress',
          description:
            'Server-sent events. `plugins` once selection is done, `step` per ledger entry, `done` with the final answer, `error` on failure. SSE comments arrive every few seconds as keep-alive — a turn can spend 20+ seconds in one model call, and a silent socket gets closed.',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              message: { type: 'string' },
              chatId: { type: 'string', default: 'web' },
              images: { type: 'array', items: { type: 'string' } },
            },
            required: ['message'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': {
              description: 'An SSE stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            '400': errorResponse('Missing or unparseable body'),
            '503': errorResponse('This instance has no conversation pipeline configured'),
          },
        },
      },

      '/api/chat/history': {
        get: {
          operationId: 'getHistory',
          tags: ['chat'],
          summary: 'Read a conversation back',
          description:
            'Turns, not raw messages. Grouping once on the server is what stops three clients reassembling tool calls three slightly different ways.',
          parameters: [
            query('chatId', { type: 'string', default: 'app' }, 'Which conversation to read.'),
            query(
              'limit',
              { type: 'integer', default: 20, maximum: 100 },
              'Turns per page. This caps the *screen*; the model has its own separate history cap.'
            ),
            query(
              'before',
              { type: 'integer' },
              'Epoch ms. Returns turns older than this, for paging backwards.'
            ),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('A page of turns, oldest first', {
              type: 'object',
              properties: {
                chatId: { type: 'string' },
                turns: { type: 'array', items: ref('Turn') },
                hasMore: { type: 'boolean' },
              },
              required: ['chatId', 'turns', 'hasMore'],
            }),
            '503': errorResponse('No conversation store configured'),
          },
        },
        delete: {
          operationId: 'clearHistory',
          tags: ['chat'],
          summary: 'Start a fresh conversation',
          description:
            'Clears one thread. Implemented as a delete rather than by inventing a new id, so old threads cannot accumulate invisibly forever.',
          parameters: [query('chatId', { type: 'string', default: 'app' }, 'Which to clear.')],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Cleared', {
              type: 'object',
              properties: { success: { type: 'boolean' }, deleted: { type: 'integer' } },
            }),
            '503': errorResponse('No conversation store configured'),
          },
        },
      },

      '/api/skills': {
        get: {
          operationId: 'listSkills',
          tags: ['skills'],
          summary: 'Every skill, with the descriptor a client renders it from',
          parameters: [
            query('plugin', { type: 'string' }, 'Only this plugin.'),
            query(
              'aiInvocable',
              { type: 'string', enum: ['true', 'false'] },
              'Skills the agent may call, or the ones only a client can.'
            ),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('The skill list', {
              type: 'object',
              properties: { skills: { type: 'array', items: ref('Skill') } },
              required: ['skills'],
            }),
          },
        },
      },

      '/api/skills/{id}/invoke': {
        post: {
          operationId: 'invokeSkill',
          tags: ['skills'],
          summary: 'Run a skill directly, without the model',
          description:
            'The same validation the agent loop uses. Reaching a skill over HTTP is a different door, not a weaker one: a workflow skill still needs approval, and read-only mode still refuses a write.',
          parameters: [path('id', 'Fully-qualified skill id, e.g. budget.this-month.')],
          requestBody: jsonBody(
            {
              type: 'object',
              properties: { args: { type: 'object', additionalProperties: true } },
            },
            false
          ),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('The skill result', {
              type: 'object',
              properties: { success: { type: 'boolean' }, data: {} },
              required: ['success'],
            }),
            '400': errorResponse('The arguments did not validate'),
            '403': errorResponse('READ_ONLY — this skill changes state and TARDIS is read-only'),
            '404': errorResponse('No such skill'),
            '409': errorResponse('APPROVAL_REQUIRED — this skill needs a yes first'),
            '503': errorResponse('Skill invocation is not configured'),
          },
        },
      },

      '/api/plugins': {
        get: {
          operationId: 'listPlugins',
          tags: ['plugins'],
          summary: 'Loaded plugins',
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('One card per plugin', {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  displayName: { type: 'string' },
                  version: { type: 'string' },
                  tier: { type: 'integer', enum: [1, 2, 3] },
                  summary: { type: 'string' },
                  toolCount: { type: 'integer' },
                },
                required: ['name', 'displayName', 'version', 'tier', 'summary'],
              },
            }),
          },
        },
      },

      '/api/plugins/{name}/config': {
        get: {
          operationId: 'getPluginConfig',
          tags: ['plugins'],
          summary: "A plugin's settings, and how to render a form for them",
          parameters: [path('name', 'Plugin name.')],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Schema and resolved values', {
              type: 'object',
              properties: {
                plugin: { type: 'string' },
                schema: { type: 'object', additionalProperties: ref('PluginConfigField') },
                values: {
                  type: 'object',
                  additionalProperties: true,
                  description: 'Declared defaults overlaid by config.json. Secrets are masked.',
                },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { key: { type: 'string' }, message: { type: 'string' } },
                  },
                  description: 'Problems with the stored settings, including unknown keys.',
                },
                writable: { type: 'boolean' },
              },
              required: ['plugin', 'schema', 'values', 'issues', 'writable'],
            }),
            '404': errorResponse('No such plugin'),
          },
        },
        put: {
          operationId: 'updatePluginConfig',
          tags: ['plugins'],
          summary: "Change a plugin's settings",
          description:
            'Resubmitting a masked secret means "unchanged" — otherwise opening the form and pressing save would overwrite every token with bullet characters.',
          parameters: [path('name', 'Plugin name.')],
          requestBody: jsonBody({
            type: 'object',
            properties: { values: { type: 'object', additionalProperties: true } },
            required: ['values'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Saved', {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                values: { type: 'object', additionalProperties: true },
                restartRequired: {
                  type: 'boolean',
                  description: 'Plugins read their settings at activation.',
                },
              },
            }),
            '400': errorResponse('INVALID_CONFIG — nothing was written'),
            '404': errorResponse('No such plugin'),
            '503': errorResponse('This instance has no config writer'),
          },
        },
      },

      '/api/memory': {
        get: {
          operationId: 'listMemories',
          tags: ['memory'],
          summary: 'Browse memories',
          parameters: [
            query('limit', { type: 'integer', default: 50, maximum: 200 }, 'Per page.'),
            query('page', { type: 'integer', default: 1 }, 'One-based.'),
            query('type', { type: 'string', enum: ['user_fact', 'project', 'preference', 'plugin'] }, 'Filter by kind.'),
            query('search', { type: 'string' }, 'Substring match on key or value.'),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('A page of memories. Stored vectors are never returned.', {
              type: 'object',
              properties: {
                data: { type: 'array', items: { type: 'object', additionalProperties: true } },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
            }),
          },
        },
        post: {
          operationId: 'saveMemory',
          tags: ['memory'],
          summary: 'Create or replace a memory',
          requestBody: jsonBody({ type: 'object', additionalProperties: true }),
          responses: {
            '401': UNAUTHORIZED,
            '201': jsonResponse('Stored', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            '400': errorResponse('Validation failed'),
          },
        },
      },

      '/api/memory/{id}': {
        patch: {
          operationId: 'updateMemory',
          tags: ['memory'],
          summary: 'Edit a memory',
          description:
            'Editing the text drops the stored vector, which is rebuilt if an embedder is configured. A vector that outlives its text makes a memory findable by what it used to say.',
          parameters: [path('id', 'Memory id.')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              type: { type: 'string' },
              key: { type: 'string' },
              value: { type: 'string' },
              source: { type: 'string' },
            },
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Updated', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            '400': errorResponse('Unparseable body'),
          },
        },
        delete: {
          operationId: 'deleteMemory',
          tags: ['memory'],
          summary: 'Forget a memory',
          parameters: [path('id', 'Memory id.')],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Deleted', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
          },
        },
      },

      '/api/memory/export': {
        get: {
          operationId: 'exportMemories',
          tags: ['memory'],
          summary: 'Every memory as Markdown',
          responses: {
            '401': UNAUTHORIZED,
            '200': {
              description: 'A Markdown document',
              content: { 'text/markdown': { schema: { type: 'string' } } },
            },
          },
        },
      },

      '/api/memory/reindex': {
        post: {
          operationId: 'reindexMemories',
          tags: ['memory'],
          summary: 'Rebuild memory vectors from the rows',
          description:
            'The row is the truth and the embedding is derived, so this can always be run and can never lose anything — the worst case is the time it takes.',
          parameters: [
            query(
              'full',
              { type: 'string', enum: ['true'] },
              'Drop existing vectors first, for a model that changed behind an unchanged name. Without it, only gaps are filled — which is what to run after an embedder outage.'
            ),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('What it did', {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                indexed: { type: 'integer' },
                failed: { type: 'integer' },
                model: { type: 'string' },
              },
            }),
            '503': errorResponse('NO_EMBEDDER — memory search is keyword-only here'),
          },
        },
      },

      '/api/proactive/triggers': {
        get: {
          operationId: 'listTriggers',
          tags: ['proactive'],
          summary: 'Scheduled triggers, and when each next fires',
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Every registered trigger', {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      pluginName: { type: 'string' },
                      triggerName: { type: 'string' },
                      description: { type: 'string' },
                      enabled: { type: 'boolean' },
                      schedule: { type: 'string' },
                      scheduleKind: { type: 'string', enum: ['cron', 'rrule'] },
                      quietHoursStart: { type: ['string', 'null'] },
                      quietHoursEnd: { type: ['string', 'null'] },
                      nextRunAt: {
                        type: ['integer', 'null'],
                        description:
                          'Epoch ms, quiet hours accounted for. Null when disabled, when the rule has no future occurrence, or when quiet hours swallow every one.',
                      },
                    },
                  },
                },
              },
            }),
            '503': errorResponse('No scheduler configured'),
          },
        },
      },

      '/api/proactive/triggers/toggle': {
        put: {
          operationId: 'toggleTrigger',
          tags: ['proactive'],
          summary: 'Enable or disable a trigger',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              pluginName: { type: 'string' },
              triggerName: { type: 'string' },
              enabled: { type: 'boolean' },
            },
            required: ['pluginName', 'triggerName', 'enabled'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Toggled', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            '400': errorResponse('Missing fields'),
            '404': errorResponse('No such trigger'),
            '503': errorResponse('No scheduler configured'),
          },
        },
      },

      '/api/proactive/triggers/schedule': {
        put: {
          operationId: 'rescheduleTrigger',
          tags: ['proactive'],
          summary: 'Reschedule a trigger',
          description:
            'Accepts a cron expression or an RRULE — `FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17` says "the last Friday of the month", which cron cannot. RRULE times are read as local wall-clock, like cron; TZID is not supported.',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              pluginName: { type: 'string' },
              triggerName: { type: 'string' },
              schedule: { type: 'string', example: '0 9 * * *' },
            },
            required: ['pluginName', 'triggerName', 'schedule'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Rescheduled', {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                nextRunAt: { type: ['integer', 'null'] },
              },
            }),
            '400': errorResponse('INVALID_SCHEDULE — it would never have fired'),
            '404': errorResponse('No such trigger'),
            '503': errorResponse('No scheduler configured'),
          },
        },
      },

      '/api/proactive/triggers/quiet-hours': {
        put: {
          operationId: 'setTriggerQuietHours',
          tags: ['proactive'],
          summary: 'Set the hours a trigger must not fire in',
          description: 'A run landing inside quiet hours is skipped, not deferred.',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              pluginName: { type: 'string' },
              triggerName: { type: 'string' },
              start: { type: ['string', 'null'], example: '22:00' },
              end: { type: ['string', 'null'], example: '08:00' },
            },
            required: ['pluginName', 'triggerName'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Set', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            '400': errorResponse('Missing fields'),
            '404': errorResponse('No such trigger'),
            '503': errorResponse('No scheduler configured'),
          },
        },
      },

      '/api/proactive/logs': {
        get: {
          operationId: 'listTriggerRuns',
          tags: ['proactive'],
          summary: 'What the scheduler has actually run',
          parameters: [
            query('limit', { type: 'integer', default: 20 }, 'Per page.'),
            query('page', { type: 'integer', default: 1 }, 'One-based.'),
            query('pluginName', { type: 'string' }, 'Filter by plugin.'),
            query('triggerName', { type: 'string' }, 'Filter by trigger.'),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Execution history', {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      pluginName: { type: 'string' },
                      triggerName: { type: 'string' },
                      status: { type: 'string', enum: ['success', 'error'] },
                      message: { type: ['string', 'null'] },
                      timestamp: { type: 'integer' },
                      durationMs: { type: ['integer', 'null'] },
                    },
                  },
                },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
            }),
            '503': errorResponse('No scheduler configured'),
          },
        },
      },

      '/api/traces': {
        get: {
          operationId: 'listTraces',
          tags: ['traces'],
          summary: 'Every agent run, newest first',
          parameters: [
            query('limit', { type: 'integer', default: 20, maximum: 100 }, 'Per page.'),
            query('page', { type: 'integer', default: 1 }, 'One-based.'),
          ],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('A page of trace summaries', {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      userMessage: { type: 'string' },
                      finalResponse: { type: ['string', 'null'] },
                      modelUsed: { type: ['string', 'null'] },
                      totalDurationMs: { type: ['integer', 'null'] },
                      tokenCount: { type: ['integer', 'null'] },
                      timestamp: { type: 'integer' },
                      stepCount: { type: 'integer' },
                    },
                  },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
            }),
          },
        },
      },

      '/api/traces/{id}': {
        get: {
          operationId: 'getTrace',
          tags: ['traces'],
          summary: 'One agent run, in full',
          parameters: [path('id', 'Trace id.')],
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('The complete ledger', {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userMessage: { type: 'string' },
                steps: { type: 'array', items: ref('AgentStep') },
                finalResponse: { type: ['string', 'null'] },
                totalDurationMs: { type: ['integer', 'null'] },
                modelUsed: { type: ['string', 'null'] },
                tokenCount: { type: ['integer', 'null'] },
                timestamp: { type: 'integer' },
              },
            }),
            '404': errorResponse('No such trace'),
          },
        },
      },

      '/api/config/llm': {
        get: {
          operationId: 'getModelConfig',
          tags: ['config'],
          summary: 'The model TARDIS is running',
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Provider settings, with the API key redacted', {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                model: { type: 'string' },
                baseUrl: { type: 'string' },
                temperature: { type: 'number' },
                contextWindowSize: { type: 'integer' },
                apiKey: { type: 'string', example: '[redacted]' },
              },
            }),
          },
        },
        put: {
          operationId: 'updateModelConfig',
          tags: ['config'],
          summary: 'Change the model',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
              baseUrl: { type: 'string' },
              apiKey: { type: 'string' },
              temperature: { type: 'number' },
              contextWindowSize: { type: 'integer' },
            },
            required: ['provider', 'model'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Saved', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            '400': errorResponse('Validation failed'),
          },
        },
      },

      '/api/config/llm/models': {
        post: {
          operationId: 'listAvailableModels',
          tags: ['config'],
          summary: 'List the models a provider offers',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              provider: { type: 'string' },
              baseUrl: { type: 'string' },
              apiKey: { type: 'string' },
            },
            required: ['provider'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Model ids', {
              type: 'object',
              properties: { models: { type: 'array', items: { type: 'string' } } },
            }),
            '400': errorResponse('Validation failed'),
          },
        },
      },

      '/api/config/llm/test': {
        post: {
          operationId: 'testModelConfig',
          tags: ['config'],
          summary: 'Check that a provider answers before committing to it',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
              baseUrl: { type: 'string' },
              apiKey: { type: 'string' },
            },
            required: ['provider', 'model'],
          }),
          responses: {
            '401': UNAUTHORIZED,
            '200': jsonResponse('Whether it answered', {
              type: 'object',
              properties: { success: { type: 'boolean' }, error: { type: 'string' } },
            }),
            '400': errorResponse('Validation failed'),
          },
        },
      },
    },
  };
}
