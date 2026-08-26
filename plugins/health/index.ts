import { randomUUID } from 'crypto';
import type { PluginAPI } from '@tardis/core';

// ─── Types ───

interface FoodItem {
  name: string;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

interface Entry {
  id: string;
  at: number;
  date: string; // YYYY-MM-DD, local
  source: 'text' | 'photo';
  mealType: string;
  description: string;
  items: FoodItem[];
  totalKcal: number;
  note?: string;
}

let api: PluginAPI;

const entryKey = (id: string): string => `entry:${id}`;

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Estimation prompt ───

/**
 * The model systematically UNDER-counts calorie-dense, low-volume foods — oils,
 * butter, cheese, nuts, seeds, dressings. Those are exactly the things that
 * dominate a meal's calories while occupying almost no space on a plate, and in
 * a photo they are often invisible entirely (food fried in oil looks like food).
 *
 * So the prompt does two things: it names the failure mode explicitly, and it
 * forces the fats to be listed as their own line items. An item the model has to
 * write down is one it cannot quietly omit.
 */
const ESTIMATION_RULES = [
  'You estimate the calories and macros of a meal.',
  '',
  'Calorie-dense, low-volume foods are easy to miss and are usually what makes a meal',
  'high-calorie. Cooking oil, butter, ghee, cheese, nuts, seeds, mayonnaise, dressings and',
  'sauces must each be listed as their OWN item with a realistic amount, never folded into',
  'another item. If a dish was fried, sauteed, roasted or dressed, assume added fat was used',
  'and include it even when it is not mentioned or visible.',
  '',
  'Typical amounts to use when unstated: pan-fried or sauteed = 1 tbsp oil (120 kcal);',
  'roasted vegetables = 1 tbsp oil; salad with dressing = 2 tbsp (150 kcal); bread served',
  'with butter = 10 g butter (72 kcal).',
  '',
  'Prefer a realistic-to-slightly-high estimate over a low one: an undercount is worse than',
  'an overcount for someone tracking intake.',
  '',
  'Reply with ONLY a JSON object, no prose and no code fences:',
  '{"items":[{"name":"...","kcal":0,"protein":0,"carbs":0,"fat":0}],"summary":"short phrase"}',
].join('\n');

/** Pulls a JSON object out of a model reply that may be wrapped in prose or fences. */
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

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseItems(payload: Record<string, unknown> | null): FoodItem[] {
  const raw = payload?.['items'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .map((i) => {
      const item: FoodItem = {
        name: String(i['name'] ?? 'item'),
        kcal: Math.round(toNumber(i['kcal'])),
      };
      const p = toNumber(i['protein']);
      const c = toNumber(i['carbs']);
      const f = toNumber(i['fat']);
      if (p) item.protein = Math.round(p);
      if (c) item.carbs = Math.round(c);
      if (f) item.fat = Math.round(f);
      return item;
    })
    .filter((i) => i.name.length > 0);
}

async function saveEntry(entry: Entry): Promise<void> {
  await api.storage.set(entryKey(entry.id), entry);
}

async function allEntries(): Promise<Entry[]> {
  const keys = await api.storage.list('entry:');
  const entries: Entry[] = [];
  for (const key of keys) {
    const e = await api.storage.get<Entry>(key);
    if (e) entries.push(e);
  }
  return entries.sort((a, b) => b.at - a.at);
}

function macroTotals(items: FoodItem[]): { protein: number; carbs: number; fat: number } {
  return items.reduce(
    (acc, i) => ({
      protein: acc.protein + (i.protein ?? 0),
      carbs: acc.carbs + (i.carbs ?? 0),
      fat: acc.fat + (i.fat ?? 0),
    }),
    { protein: 0, carbs: 0, fat: 0 }
  );
}

function describeItems(items: FoodItem[]): string {
  return items.map((i) => `${i.name} ${i.kcal} kcal`).join(', ');
}

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const count = (await api.storage.list('entry:')).length;
  api.logger.info(`Health plugin activated — ${count} entr(ies) logged`);
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Health plugin deactivated');
};

// ─── Tools ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'health.log-meal': {
      const description = String(args['description'] ?? '').trim();
      if (!description) return { success: false, message: 'Describe what you ate.' };

      // A figure the user stated beats anything the model would guess. Estimating
      // over the top of it — and silently reporting a different number — is worse
      // than not logging at all.
      const statedCalories = Math.round(toNumber(args['calories']));
      if (statedCalories > 0) {
        const entry: Entry = {
          id: randomUUID(),
          at: Date.now(),
          date: localDate(Date.now()),
          source: 'text',
          mealType: String(args['mealType'] ?? 'meal'),
          description,
          items: [{ name: description, kcal: statedCalories }],
          totalKcal: statedCalories,
        };
        await saveEntry(entry);
        return {
          success: true,
          message: `Logged ${statedCalories} kcal.`,
          entry: {
            id: entry.id,
            totalKcal: statedCalories,
            items: entry.items,
            macros: macroTotals(entry.items),
            estimated: false,
          },
        };
      }

      const reply = await api.llm.generate(`Meal: ${description}`, {
        systemPrompt: ESTIMATION_RULES,
        temperature: 0.2,
        maxTokens: 600,
      });

      const payload = extractJson(reply);
      const items = parseItems(payload);
      if (items.length === 0) {
        // Better to say the estimate failed than to record a zero-calorie meal.
        return {
          success: false,
          message: 'Could not estimate that meal. Try describing it in more detail.',
        };
      }

      const entry: Entry = {
        id: randomUUID(),
        at: Date.now(),
        date: localDate(Date.now()),
        source: 'text',
        mealType: String(args['mealType'] ?? 'meal'),
        description,
        items,
        totalKcal: items.reduce((sum, i) => sum + i.kcal, 0),
      };
      await saveEntry(entry);

      return {
        success: true,
        message: `Logged ${entry.totalKcal} kcal.`,
        entry: {
          id: entry.id,
          totalKcal: entry.totalKcal,
          items: entry.items,
          macros: macroTotals(items),
        },
      };
    }

    case 'health.log-photo': {
      const image = String(args['image'] ?? '');
      if (!image.startsWith('data:')) {
        return { success: false, message: 'Attach a photo of the meal.' };
      }
      const note = String(args['note'] ?? '').trim();

      // One image per call — the API enforces it, and multiple photos must be
      // logged separately rather than blended into one wrong estimate.
      const reply = await api.llm.analyzeImage(
        note
          ? `Identify everything in this meal and estimate it. Also account for: ${note}`
          : 'Identify everything in this meal and estimate it.',
        image,
        { systemPrompt: ESTIMATION_RULES, temperature: 0.2, maxTokens: 600 }
      );

      const items = parseItems(extractJson(reply));
      if (items.length === 0) {
        return {
          success: false,
          message: 'Could not read that photo. Try a clearer shot, or log it by description.',
        };
      }

      const entry: Entry = {
        id: randomUUID(),
        at: Date.now(),
        date: localDate(Date.now()),
        source: 'photo',
        mealType: String(args['mealType'] ?? 'meal'),
        description: describeItems(items),
        items,
        totalKcal: items.reduce((sum, i) => sum + i.kcal, 0),
        ...(note ? { note } : {}),
      };
      await saveEntry(entry);

      return {
        success: true,
        message: `Logged ${entry.totalKcal} kcal from photo.`,
        entry: {
          id: entry.id,
          totalKcal: entry.totalKcal,
          items: entry.items,
          macros: macroTotals(items),
        },
      };
    }

    case 'health.today': {
      const today = localDate(Date.now());
      const entries = (await allEntries()).filter((e) => e.date === today);
      if (entries.length === 0) {
        return { entries: [], totalKcal: 0, message: 'Nothing logged today.' };
      }

      const totalKcal = entries.reduce((sum, e) => sum + e.totalKcal, 0);
      const macros = macroTotals(entries.flatMap((e) => e.items));

      return {
        entries: entries.map((e) => ({
          id: e.id,
          summary: `${e.totalKcal} kcal — ${e.description}`,
          detail: describeItems(e.items),
          mealType: e.mealType,
          loggedAt: new Date(e.at).toLocaleTimeString('en-GB', { timeStyle: 'short' }),
          totalKcal: e.totalKcal,
        })),
        totalKcal,
        macros,
        message: `${totalKcal} kcal today across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`,
      };
    }

    case 'health.summary': {
      const days = Math.min(Math.max(Math.round(toNumber(args['days']) || 7), 1), 90);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const entries = (await allEntries()).filter((e) => e.at >= cutoff);

      if (entries.length === 0) {
        return { days: [], message: `Nothing logged in the last ${days} days.` };
      }

      const byDate = new Map<string, Entry[]>();
      for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

      const rows = [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([date, list]) => {
          const kcal = list.reduce((sum, e) => sum + e.totalKcal, 0);
          const m = macroTotals(list.flatMap((e) => e.items));
          return {
            date,
            summary: `${kcal} kcal · P${m.protein} C${m.carbs} F${m.fat}`,
            entryCount: `${list.length} entr${list.length === 1 ? 'y' : 'ies'}`,
            totalKcal: kcal,
          };
        });

      const avg = Math.round(rows.reduce((s, r) => s + r.totalKcal, 0) / rows.length);
      return { days: rows, averageKcal: avg, message: `Averaging ${avg} kcal/day over ${rows.length} logged day(s).` };
    }

    case 'health.delete-entry': {
      const id = String(args['id'] ?? '').trim();
      if (!id) return { success: false, message: 'Entry id is required.' };
      const existing = await api.storage.get<Entry>(entryKey(id));
      if (!existing) return { success: false, message: `No entry with id "${id}".` };
      await api.storage.delete(entryKey(id));
      return { success: true, message: `Deleted "${existing.description}".` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
