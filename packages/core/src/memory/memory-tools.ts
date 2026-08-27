import type { ToolDefinition, MemoryType } from '@tardis/shared';
import type { MemoryStore } from './memory-store.js';
import type { MemoryIndexer } from './memory-indexer.js';

// ─── Tool definitions (always injected, not subject to skill selection) ───

export const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'memory.save',
    description:
      'Save a fact about the user or their preferences to long-term memory. ' +
      'Use when the user shares personal info, preferences, or context you should remember across conversations.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'A short snake_case label for the memory, e.g. "ahmad_email", "preferred_language", "project_deadline"',
        },
        value: {
          type: 'string',
          description: 'The information to remember',
        },
        type: {
          type: 'string',
          enum: ['user_fact', 'preference', 'project'],
          description: 'Category: user_fact (personal info), preference (settings/choices), project (work context)',
        },
      },
      required: ['key', 'value'],
    },
    actionType: 'direct',
    mutates: true,
  },
  {
    name: 'memory.recall',
    description:
      'Search long-term memory for stored facts. Use when you need to look up something the user told you before.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to find relevant memories',
        },
      },
      required: ['query'],
    },
    actionType: 'direct',
    mutates: false,
  },
  {
    name: 'memory.forget',
    description: 'Delete a memory by its key. Use when the user asks you to forget something.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The key of the memory to delete',
        },
      },
      required: ['key'],
    },
    actionType: 'direct',
    mutates: true,
  },
];

// ─── Executor ───

export interface MemoryExecutor {
  execute(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * @param indexer optional. Without it, save skips embedding and recall is
 * keyword-only — the behaviour that shipped before vectors existed.
 */
export function createMemoryExecutor(
  store: MemoryStore,
  indexer?: MemoryIndexer
): MemoryExecutor {
  return {
    async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      switch (toolName) {
        case 'memory.save': {
          const key = String(args['key'] ?? '');
          const value = String(args['value'] ?? '');
          const type = (args['type'] as MemoryType) ?? 'user_fact';

          if (!key || !value) {
            return { success: false, message: 'Both key and value are required' };
          }

          const saved = await store.upsertByKey({ type, key, value, source: 'agent' });
          // Awaited, not fired and forgotten: a memory saved and searched in
          // the same turn is a normal thing to do, and indexOne swallows its
          // own failures, so waiting costs ~30 ms and never costs the save.
          await indexer?.indexOne(saved);
          return { success: true, message: `Saved "${key}" to memory` };
        }

        case 'memory.recall': {
          const query = String(args['query'] ?? '');
          if (!query) {
            return { success: false, message: 'Query is required' };
          }

          // Literal matches first, then anything the index considers a
          // standout. Without this second half, recalling "the car" cannot find
          // a memory phrased "vehicle down payment" — the failure that
          // motivated embeddings in the first place.
          const results = await store.search(query, 10);
          const seen = new Set(results.map((m) => m.id));
          for (const m of (await indexer?.similar(query)) ?? []) {
            if (!seen.has(m.id)) {
              results.push(m);
              seen.add(m.id);
            }
          }

          if (results.length === 0) {
            return { success: true, memories: [], message: 'No memories found' };
          }

          return {
            success: true,
            memories: results.map((m) => ({ key: m.key, value: m.value, type: m.type })),
          };
        }

        case 'memory.forget': {
          const key = String(args['key'] ?? '');
          if (!key) {
            return { success: false, message: 'Key is required' };
          }

          const deleted = await store.delete(key);
          if (!deleted) {
            return { success: false, message: `No memory found with key "${key}"` };
          }
          return { success: true, message: `Forgot "${key}"` };
        }

        default:
          throw new Error(`Unknown memory tool: ${toolName}`);
      }
    },
  };
}
