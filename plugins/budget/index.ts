import { randomUUID } from 'crypto';
import type { PluginAPI } from '@tardis/core';

// ─── Types ───

interface Spend {
  id: string;
  at: number;
  month: string; // YYYY-MM, local
  amount: number;
  category: string;
  description: string;
  merchant?: string;
  source: 'parsed' | 'manual';
}

let api: PluginAPI;

const KNOWN_CATEGORIES = [
  'groceries',
  'eating-out',
  'transport',
  'bills',
  'shopping',
  'health',
  'other',
] as const;

const spendKey = (id: string): string => `spend:${id}`;

function localMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Cached at activation. api.config.get() is async, and fmt() is called inside
 * .map() over every entry — awaiting per row would be both noisy and pointless
 * for a value that does not change while the plugin is loaded.
 */
let currencyCode = 'JOD';

function currency(): string {
  return currencyCode;
}

/** Money is rounded to 2dp on the way in, so totals never drift by float dust. */
function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function normalizeCategory(raw: unknown): string {
  const c = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  if (!c) return 'other';
  const exact = KNOWN_CATEGORIES.find((k) => k === c);
  if (exact) return exact;
  // Nudge near-misses into a known bucket so summaries do not fragment into
  // "food", "Food", "eating out" and "eating-out" as four separate categories.
  const alias: Record<string, string> = {
    food: 'eating-out',
    restaurant: 'eating-out',
    restaurants: 'eating-out',
    cafe: 'eating-out',
    coffee: 'eating-out',
    supermarket: 'groceries',
    grocery: 'groceries',
    fuel: 'transport',
    petrol: 'transport',
    gas: 'transport',
    taxi: 'transport',
    utilities: 'bills',
    rent: 'bills',
    pharmacy: 'health',
    medical: 'health',
    clothes: 'shopping',
  };
  return alias[c] ?? c;
}

const PARSE_RULES = [
  'Extract a single spending record from the sentence.',
  '',
  `Categories to choose from: ${KNOWN_CATEGORIES.join(', ')}. Pick the closest one;`,
  'use "other" only when nothing fits.',
  '',
  'Reply with ONLY a JSON object, no prose and no code fences:',
  '{"amount":0,"category":"...","merchant":"","description":"short phrase"}',
  '',
  'amount must be a plain number with no currency symbol. If no amount is stated, use 0.',
].join('\n');

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function allSpends(): Promise<Spend[]> {
  const keys = await api.storage.list('spend:');
  const out: Spend[] = [];
  for (const key of keys) {
    const s = await api.storage.get<Spend>(key);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.at - a.at);
}

function fmt(amount: number): string {
  return `${amount.toFixed(2)} ${currency()}`;
}

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  currencyCode = (await api.config.get<string>('currency')) ?? 'JOD';
  const count = (await api.storage.list('spend:')).length;
  api.logger.info(`Budget plugin activated — ${count} entr(ies), currency ${currency()}`);
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Budget plugin deactivated');
};

// ─── Tools ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'budget.log-spend': {
      const text = String(args['text'] ?? '').trim();
      if (!text) return { success: false, message: 'Say what you spent.' };

      const reply = await api.llm.generate(text, {
        systemPrompt: PARSE_RULES,
        temperature: 0.1,
        maxTokens: 200,
      });
      const parsed = extractJson(reply);
      const amount = money(parsed?.['amount']);

      if (amount <= 0) {
        // Recording a zero would quietly corrupt every later total.
        return {
          success: false,
          message: 'Could not find an amount in that. Try "spent 12.50 on coffee".',
        };
      }

      const merchant = String(parsed?.['merchant'] ?? '').trim();
      const spend: Spend = {
        id: randomUUID(),
        at: Date.now(),
        month: localMonth(Date.now()),
        amount,
        category: normalizeCategory(parsed?.['category']),
        description: String(parsed?.['description'] ?? text).trim() || text,
        source: 'parsed',
        ...(merchant ? { merchant } : {}),
      };
      await api.storage.set(spendKey(spend.id), spend);

      return {
        success: true,
        message: `Logged ${fmt(spend.amount)} to ${spend.category}${spend.merchant ? ` at ${spend.merchant}` : ''}.`,
        entry: spend,
      };
    }

    case 'budget.add-entry': {
      const amount = money(args['amount']);
      if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };

      const spend: Spend = {
        id: randomUUID(),
        at: Date.now(),
        month: localMonth(Date.now()),
        amount,
        category: normalizeCategory(args['category']),
        description: String(args['description'] ?? '').trim() || 'manual entry',
        source: 'manual',
      };
      await api.storage.set(spendKey(spend.id), spend);

      return {
        success: true,
        message: `Added ${fmt(spend.amount)} to ${spend.category}.`,
        entry: spend,
      };
    }

    case 'budget.this-month': {
      const month = localMonth(Date.now());
      const entries = (await allSpends()).filter((s) => s.month === month);
      if (entries.length === 0) {
        return { entries: [], total: 0, message: 'Nothing recorded this month.' };
      }
      const total = Math.round(entries.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;

      return {
        entries: entries.map((s) => ({
          id: s.id,
          summary: `${fmt(s.amount)} — ${s.description}`,
          description: s.merchant ? `at ${s.merchant}` : s.description,
          category: s.category,
          loggedAt: new Date(s.at).toLocaleDateString('en-GB', { dateStyle: 'medium' }),
          amount: s.amount,
        })),
        total,
        message: `${fmt(total)} across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} this month.`,
      };
    }

    case 'budget.summary': {
      const month = String(args['month'] ?? '').trim() || localMonth(Date.now());
      const entries = (await allSpends()).filter((s) => s.month === month);
      if (entries.length === 0) {
        return { categories: [], total: 0, message: `Nothing recorded for ${month}.` };
      }

      const byCategory = new Map<string, number>();
      for (const s of entries) {
        byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + s.amount);
      }
      const total = Math.round(entries.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;

      const categories = [...byCategory.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([category, amount]) => {
          const rounded = Math.round(amount * 100) / 100;
          return {
            category,
            summary: fmt(rounded),
            share: `${Math.round((rounded / total) * 100)}%`,
            amount: rounded,
          };
        });

      return {
        categories,
        total,
        month,
        message: `${fmt(total)} in ${month}, biggest category ${categories[0]?.category}.`,
      };
    }

    case 'budget.delete-entry': {
      const id = String(args['id'] ?? '').trim();
      if (!id) return { success: false, message: 'Entry id is required.' };
      const existing = await api.storage.get<Spend>(spendKey(id));
      if (!existing) return { success: false, message: `No entry with id "${id}".` };
      await api.storage.delete(spendKey(id));
      return { success: true, message: `Deleted ${fmt(existing.amount)} (${existing.category}).` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
