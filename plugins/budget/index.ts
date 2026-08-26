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

/**
 * Money is rounded on the way in so totals never drift by float dust.
 *
 * Three decimals, not two: JOD is a 1000-fils currency and real balances look
 * like 0.004, 3.500 and 4.187. Rounding those to 2dp corrupts them.
 */
const MONEY_DP = 3;
const MONEY_SCALE = 10 ** MONEY_DP;

function round(n: number): number {
  return Math.round(n * MONEY_SCALE) / MONEY_SCALE;
}

function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? round(n) : 0;
}

/**
 * Pulls the amount out of the raw SMS rather than trusting the model.
 *
 * Against a real message the model read "تم استلام3.500 دينار" as 3500 — a
 * thousandfold error, and the worst possible failure in something that adds up
 * money. The digits are right there in the text, so take them from there and
 * use the model only for meaning.
 *
 * Handles: "51.19 JOD", "JOD4.187", "3.0 دينار", "استلام3.500 دينار",
 * and thousands separators.
 */
export function extractAmount(text: string): number | null {
  const CURRENCY = String.raw`(?:JOD|jod|JD|\u062F\u064A\u0646\u0627\u0631)`;
  const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d{1,3})?|\d+(?:\.\d{1,3})?`;

  const candidates: number[] = [];
  // number before the currency word, and number after it
  for (const re of [
    new RegExp(String.raw`(${NUM})\s*${CURRENCY}`, 'g'),
    new RegExp(String.raw`${CURRENCY}\s*(${NUM})`, 'g'),
  ]) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]!.replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) candidates.push(n);
    }
  }
  if (candidates.length === 0) return null;

  // A message states the amount and then the resulting balance. The amount is
  // the FIRST currency figure; taking the largest would pick the balance.
  return round(candidates[0]!);
}

function toNumberSafe(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
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

/**
 * JOD is a 1000-fils currency, so real values carry three decimals (0.004,
 * 4.187). Show up to three, but never fewer than two, so round numbers do not
 * read as "45.000".
 */
function fmt(amount: number): string {
  const three = amount.toFixed(MONEY_DP);
  const trimmed = three.replace(/0+$/, '');
  const [whole, frac = ''] = trimmed.split('.');
  return `${whole}.${frac.padEnd(2, '0')} ${currency()}`;
}

// ─── Cards, goals, budget config ─────────────────────────────────────────────

interface Card {
  id: string;
  name: string;
  purpose: 'tap' | 'online' | 'holding';
  last4?: string;
}

interface Transfer {
  id: string;
  at: number;
  month: string;
  amount: number;
  from: string;
  to: string;
}

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  createdAt: number;
  deadline?: string;
  monthlyPayment?: number;
}

/** A fixed outgoing that happens every month regardless of behaviour. */
interface Commitment {
  name: string;
  amount: number;
}

interface BudgetConfig {
  monthlyIncome: number;
  safeFloor: number;
  categoryLimits: Record<string, number>;
  /** Your own name(s) as the bank writes them, to spot self-transfers. */
  ownerNames: string[];
  /**
   * Money that leaves at the start of every month — savings, family support,
   * subscriptions. It is committed before anything is spendable, so counting
   * it as available makes "can I survive the month" wrong by exactly that much.
   */
  commitments: Commitment[];
}

/** Loose name match: banks vary spacing, order and middle names. */
function isSelf(counterparty: string, ownerNames: string[]): boolean {
  const c = counterparty.toLowerCase().replace(/\s+/g, ' ').trim();
  if (c.length < 3) return false;
  return ownerNames.some((raw) => {
    const own = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!own) return false;
    if (c.includes(own) || own.includes(c)) return true;
    // Every word of the shorter name appearing in the longer one is enough:
    // "MOHAMMAD K M MOHAMMADTAHA" vs "Mohammad Taha".
    const [short, long] = c.length <= own.length ? [c, own] : [own, c];
    const words = short.split(' ').filter((w) => w.length > 2);
    return words.length > 0 && words.every((w) => long.includes(w));
  });
}

const cardKey = (id: string): string => `card:${id}`;
const goalKey = (id: string): string => `goal:${id}`;
const transferKey = (id: string): string => `transfer:${id}`;
const CONFIG_KEY = 'budget-config';

const DEFAULT_CONFIG: BudgetConfig = {
  monthlyIncome: 0,
  safeFloor: 0,
  categoryLimits: {},
  ownerNames: [],
  commitments: [],
};

/**
 * Always returns a complete config.
 *
 * A config stored before a field existed comes back without it, and
 * `cfg.commitments.filter(...)` on undefined throws — which is exactly what
 * happened the first time commitments shipped. Merging over the defaults
 * backfills anything a new version added.
 */
async function loadConfig(): Promise<BudgetConfig> {
  const stored = await api.storage.get<Partial<BudgetConfig>>(CONFIG_KEY);
  return {
    ...DEFAULT_CONFIG,
    ...(stored ?? {}),
    categoryLimits: stored?.categoryLimits ?? {},
    ownerNames: stored?.ownerNames ?? [],
    commitments: stored?.commitments ?? [],
  };
}

async function listAll<T>(prefix: string): Promise<T[]> {
  const keys = await api.storage.list(prefix);
  const out: T[] = [];
  for (const k of keys) {
    const v = await api.storage.get<T>(k);
    if (v) out.push(v);
  }
  return out;
}

const cards = (): Promise<Card[]> => listAll<Card>('card:');
const goals = (): Promise<Goal[]> => listAll<Goal>('goal:');

function findCard(list: Card[], needle: string): Card | undefined {
  const n = needle.toLowerCase().trim();
  // An empty or near-empty needle must match NOTHING. `"tap".includes("")` is
  // true, so without this a salary SMS naming a single account was read as a
  // transfer between two cards — income vanished and the month looked wrong.
  if (n.length < 2) return undefined;
  return (
    list.find((c) => c.name.toLowerCase() === n) ??
    list.find((c) => c.purpose === n) ??
    list.find((c) => c.last4 && n.includes(c.last4)) ??
    list.find((c) => c.name.toLowerCase().includes(n))
  );
}

function daysInMonth(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function monthsUntil(deadline: string): number | null {
  const target = Date.parse(`${deadline}T00:00:00`);
  if (Number.isNaN(target)) return null;
  return Math.max(0, (target - Date.now()) / (1000 * 60 * 60 * 24 * 30.44));
}

// ─── SMS parsing ─────────────────────────────────────────────────────────────

/**
 * A bank SMS is either money leaving for a merchant, or money moving between
 * the user's own cards.
 *
 * Getting that wrong is the expensive mistake: every internal move counted as
 * spending would double-count and quietly inflate the month. So the model is
 * asked only to READ the message, and the code decides transfer-vs-spend by
 * checking both endpoints against the registered cards.
 */
const SMS_RULES = [
  'Read the bank SMS. Messages may be in English or Arabic. Report only what it says.',
  '',
  'Reply with ONLY a JSON object, no prose and no code fences:',
  '{"direction":"out|in|unknown","counterparty":"","account":"","isMerchant":false}',
  '',
  'direction: "out" if money LEFT the account (transferred from your account,',
  'purchase, payment, withdrawal). "in" if money ARRIVED (received, credited,',
  'incoming transfer, salary). Arabic: وارد / تم استلام / لحسابكم mean money',
  'arrived; حُوّل من حسابكم means it left.',
  'counterparty: the other party — a person, a company or a shop. Copy the name',
  'as written.',
  'account: any account or card identifier the message names.',
  'isMerchant: true only if the counterparty is a shop or business, not a person.',
  '',
  'Do NOT report the amount. It is read separately.',
].join('\n');

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

    // ─── Cards ─────────────────────────────────────────────────────────────

    case 'budget.add-card': {
      const name = String(args['name'] ?? '').trim();
      const purpose = String(args['purpose'] ?? '').trim().toLowerCase();
      if (!name) return { success: false, message: 'Give the card a name.' };
      if (!['tap', 'online', 'holding'].includes(purpose)) {
        return { success: false, message: 'Purpose must be tap, online or holding.' };
      }
      const last4 = String(args['last4'] ?? '').replace(/\D/g, '').slice(-4);
      const card: Card = {
        id: randomUUID(),
        name,
        purpose: purpose as Card['purpose'],
        ...(last4 ? { last4 } : {}),
      };
      await api.storage.set(cardKey(card.id), card);
      return { success: true, message: `Added "${name}" (${purpose}).`, card };
    }

    case 'budget.cards': {
      const list = await cards();
      if (list.length === 0) return { cards: [], message: 'No cards registered.' };
      return {
        cards: list.map((c) => ({
          id: c.id,
          name: c.name,
          headline: `${c.name} — ${c.purpose}`,
          detail: c.last4 ? `ends ${c.last4}` : 'no digits recorded, SMS matching will be weaker',
        })),
        message: `${list.length} card(s) registered.`,
      };
    }

    case 'budget.delete-card': {
      const list = await cards();
      const card = findCard(list, String(args['name'] ?? ''));
      if (!card) return { success: false, message: 'No card by that name.' };
      await api.storage.delete(cardKey(card.id));
      return { success: true, message: `Removed "${card.name}".` };
    }

    case 'budget.transfer': {
      const amount = money(args['amount']);
      if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
      const list = await cards();
      const from = findCard(list, String(args['from'] ?? ''));
      const to = findCard(list, String(args['to'] ?? ''));
      if (!from || !to) {
        return {
          success: false,
          message: 'Both cards must be registered first, so this is not mistaken for spending.',
        };
      }
      const t: Transfer = {
        id: randomUUID(),
        at: Date.now(),
        month: localMonth(Date.now()),
        amount,
        from: from.name,
        to: to.name,
      };
      await api.storage.set(transferKey(t.id), t);
      // Deliberately NOT a spend record: moving your own money is not expenditure.
      return {
        success: true,
        message: `Moved ${fmt(amount)} from ${from.name} to ${to.name}. Not counted as spending.`,
        transfer: t,
      };
    }

    // ─── Budget basis ──────────────────────────────────────────────────────

    case 'budget.setup': {
      const cfg = await loadConfig();
      const income = money(args['monthlyIncome']);
      if (income <= 0) return { success: false, message: 'Monthly income must be greater than zero.' };
      cfg.monthlyIncome = income;
      const floor = money(args['safeFloor']);
      if (floor >= 0) cfg.safeFloor = floor;

      const ownerName = String(args['ownerName'] ?? '').trim();
      if (ownerName && !cfg.ownerNames.includes(ownerName)) {
        cfg.ownerNames = [...cfg.ownerNames, ownerName];
      }

      await api.storage.set(CONFIG_KEY, cfg);
      return {
        success: true,
        message:
          `Income ${fmt(cfg.monthlyIncome)}/month, keeping at least ${fmt(cfg.safeFloor)}.` +
          (cfg.ownerNames.length > 0
            ? ` Transfers naming ${cfg.ownerNames.join(' or ')} count as your own.`
            : ''),
      };
    }

    case 'budget.add-commitment': {
      const cfg = await loadConfig();
      const name = String(args['name'] ?? '').trim();
      const amount = money(args['amount']);
      if (!name) return { success: false, message: 'Name the commitment.' };
      if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
      cfg.commitments = [...cfg.commitments.filter((c) => c.name.toLowerCase() !== name.toLowerCase()), { name, amount }];
      await api.storage.set(CONFIG_KEY, cfg);
      const committed = round(cfg.commitments.reduce((sum, c) => sum + c.amount, 0));
      return {
        success: true,
        message: `${name}: ${fmt(amount)}/month. ${fmt(committed)} committed in total, leaving ${fmt(round(cfg.monthlyIncome - committed - cfg.safeFloor))} spendable.`,
      };
    }

    case 'budget.remove-commitment': {
      const cfg = await loadConfig();
      const name = String(args['name'] ?? '').toLowerCase().trim();
      const before = cfg.commitments.length;
      cfg.commitments = cfg.commitments.filter((c) => !c.name.toLowerCase().includes(name));
      if (cfg.commitments.length === before) return { success: false, message: 'No commitment by that name.' };
      await api.storage.set(CONFIG_KEY, cfg);
      return { success: true, message: `Removed "${name}".` };
    }

    case 'budget.commitments': {
      const cfg = await loadConfig();
      if (cfg.commitments.length === 0) return { commitments: [], message: 'No fixed monthly commitments.' };
      const committed = round(cfg.commitments.reduce((sum, c) => sum + c.amount, 0));
      return {
        commitments: cfg.commitments.map((c) => ({
          id: c.name,
          name: c.name,
          headline: `${c.name} — ${fmt(c.amount)}/month`,
          detail: cfg.monthlyIncome > 0 ? `${Math.round((c.amount / cfg.monthlyIncome) * 100)}% of income` : '',
        })),
        total: committed,
        message: `${fmt(committed)} committed each month, leaving ${fmt(round(cfg.monthlyIncome - committed - cfg.safeFloor))} spendable.`,
      };
    }

    case 'budget.set-limit': {
      const cfg = await loadConfig();
      const category = normalizeCategory(args['category']);
      const limit = money(args['limit']);
      if (limit > 0) cfg.categoryLimits[category] = limit;
      else delete cfg.categoryLimits[category];
      await api.storage.set(CONFIG_KEY, cfg);
      return {
        success: true,
        message: limit > 0 ? `${category} limited to ${fmt(limit)}/month.` : `Removed the ${category} limit.`,
      };
    }

    case 'budget.status': {
      const cfg = await loadConfig();
      const month = localMonth(Date.now());
      const entries = (await allSpends()).filter((s) => s.month === month);
      const spent = Math.round(entries.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;

      const now = new Date();
      const dayOfMonth = now.getDate();
      const total = daysInMonth(now);
      const daysLeft = Math.max(0, total - dayOfMonth);
      const burn = dayOfMonth > 0 ? spent / dayOfMonth : 0;
      const projected = Math.round((spent + burn * daysLeft) * 100) / 100;

      const lines: { key: string; headline: string; detail: string }[] = [];

      lines.push({
        key: 'spent',
        headline: `${fmt(spent)} spent · day ${dayOfMonth} of ${total}`,
        detail: `burning ${fmt(Math.round(burn * 100) / 100)}/day, ${daysLeft} days left`,
      });

      const committed = round(cfg.commitments.reduce((sum, c) => sum + c.amount, 0));
      if (committed > 0) {
        lines.push({
          key: 'committed',
          headline: `${fmt(committed)} committed before anything else`,
          detail: cfg.commitments.map((c) => `${c.name} ${fmt(c.amount)}`).join(' · '),
        });
      }

      if (cfg.monthlyIncome > 0) {
        const allowance = round(cfg.monthlyIncome - committed - cfg.safeFloor);
        const overBy = Math.round((projected - allowance) * 100) / 100;
        if (overBy > 0) {
          // The number that actually answers "can I survive the month".
          const safeDaily = daysLeft > 0
            ? Math.max(0, Math.round(((allowance - spent) / daysLeft) * 100) / 100)
            : 0;
          lines.push({
            key: 'warning',
            headline: `On pace to overshoot by ${fmt(overBy)}`,
            detail: `Projected ${fmt(projected)} against ${fmt(allowance)} spendable (${fmt(cfg.monthlyIncome)} in, less ${fmt(committed)} committed and ${fmt(cfg.safeFloor)} kept back). Ease to ${fmt(safeDaily)}/day to land safe.`,
          });
        } else {
          lines.push({
            key: 'ok',
            headline: `On pace to finish ${fmt(Math.abs(overBy))} under`,
            detail: `Projected ${fmt(projected)} against ${fmt(allowance)} spendable (${fmt(cfg.monthlyIncome)} in, less ${fmt(committed)} committed and ${fmt(cfg.safeFloor)} kept back).`,
          });
        }
      } else {
        lines.push({
          key: 'no-income',
          headline: 'No income set',
          detail: 'Set it so I can tell you whether you will make it to month end.',
        });
      }

      const byCategory = new Map<string, number>();
      for (const s of entries) byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + s.amount);
      for (const [category, limit] of Object.entries(cfg.categoryLimits)) {
        const used = Math.round((byCategory.get(category) ?? 0) * 100) / 100;
        if (used > limit) {
          lines.push({
            key: `cat-${category}`,
            headline: `${category} is over by ${fmt(Math.round((used - limit) * 100) / 100)}`,
            detail: `${fmt(used)} of ${fmt(limit)}`,
          });
        } else if (limit > 0 && used / limit >= 0.8) {
          lines.push({
            key: `cat-${category}`,
            headline: `${category} at ${Math.round((used / limit) * 100)}% of its limit`,
            detail: `${fmt(used)} of ${fmt(limit)}`,
          });
        }
      }

      return { lines, spent, projected, message: lines[1]?.headline ?? lines[0]!.headline };
    }

    // ─── Goals ─────────────────────────────────────────────────────────────

    case 'budget.add-goal': {
      const name = String(args['name'] ?? '').trim();
      const target = money(args['target']);
      if (!name) return { success: false, message: 'What are you saving for?' };
      if (target <= 0) return { success: false, message: 'Target must be greater than zero.' };
      const deadline = String(args['deadline'] ?? '').trim();
      const monthlyPayment = money(args['monthlyPayment']);
      const goal: Goal = {
        id: randomUUID(),
        name,
        target,
        saved: 0,
        createdAt: Date.now(),
        ...(deadline ? { deadline } : {}),
        ...(monthlyPayment > 0 ? { monthlyPayment } : {}),
      };
      await api.storage.set(goalKey(goal.id), goal);
      return { success: true, message: `Saving for ${name}: ${fmt(target)}.`, goal };
    }

    case 'budget.contribute': {
      const list = await goals();
      const needle = String(args['name'] ?? '').toLowerCase().trim();
      const goal = list.find((g) => g.name.toLowerCase() === needle)
        ?? list.find((g) => g.name.toLowerCase().includes(needle));
      if (!goal) return { success: false, message: 'No goal by that name.' };
      const amount = money(args['amount']);
      if (amount <= 0) return { success: false, message: 'Amount must be greater than zero.' };
      goal.saved = Math.round((goal.saved + amount) * 100) / 100;
      await api.storage.set(goalKey(goal.id), goal);
      const left = Math.max(0, Math.round((goal.target - goal.saved) * 100) / 100);
      return {
        success: true,
        message: left > 0
          ? `${fmt(goal.saved)} of ${fmt(goal.target)} toward ${goal.name}. ${fmt(left)} to go.`
          : `${goal.name} is fully funded.`,
        goal,
      };
    }

    case 'budget.goals': {
      const list = (await goals()).sort((a, b) => b.saved / b.target - a.saved / a.target);
      if (list.length === 0) return { goals: [], message: 'No goals yet.' };

      // Pace uses what has actually been saved since the goal was created, so it
      // reflects real behaviour rather than an assumed contribution.
      return {
        goals: list.map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
          const left = Math.max(0, Math.round((g.target - g.saved) * 100) / 100);
          const monthsSaving = Math.max(0.5, (Date.now() - g.createdAt) / (1000 * 60 * 60 * 24 * 30.44));
          const rate = g.saved / monthsSaving;

          const ageDays = (Date.now() - g.createdAt) / (1000 * 60 * 60 * 24);
          let pace = 'no deadline';
          if (ageDays < 7 && !g.deadline) {
            // Too new to infer a rate from; saying "1 month" would be invented.
            pace = 'too new to project';
          } else if (g.deadline) {
            const monthsLeft = monthsUntil(g.deadline);
            if (monthsLeft !== null) {
              const needed = monthsLeft > 0 ? left / monthsLeft : left;
              pace = rate >= needed
                ? `on pace (${fmt(Math.round(rate * 100) / 100)}/mo)`
                : `behind — needs ${fmt(Math.round(needed * 100) / 100)}/mo, saving ${fmt(Math.round(rate * 100) / 100)}/mo`;
            }
          } else if (rate > 0 && left > 0) {
            pace = `about ${Math.ceil(left / rate)} month(s) at this rate`;
          }

          return {
            id: g.id,
            name: g.name,
            headline: `${g.name} — ${fmt(g.saved)} of ${fmt(g.target)} (${pct}%)`,
            detail: left > 0 ? `${fmt(left)} to go` : 'fully funded',
            pace,
          };
        }),
        message: `${list.length} goal(s).`,
      };
    }

    case 'budget.delete-goal': {
      const list = await goals();
      const needle = String(args['name'] ?? '').toLowerCase().trim();
      const goal = list.find((g) => g.name.toLowerCase().includes(needle));
      if (!goal) return { success: false, message: 'No goal by that name.' };
      await api.storage.delete(goalKey(goal.id));
      return { success: true, message: `Deleted "${goal.name}".` };
    }

    // ─── Habits ────────────────────────────────────────────────────────────

    case 'budget.habits': {
      const months = Math.min(Math.max(Math.round(toNumberSafe(args['months']) || 3), 1), 24);
      const cutoff = Date.now() - months * 30.44 * 24 * 60 * 60 * 1000;
      const entries = (await allSpends()).filter((s) => s.at >= cutoff);
      if (entries.length < 3) {
        return { findings: [], message: 'Not enough history yet — log a few more and ask again.' };
      }

      const findings: { key: string; headline: string; detail: string }[] = [];
      const total = entries.reduce((s, e) => s + e.amount, 0);

      const byCat = new Map<string, number>();
      for (const e of entries) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
      const [topCat, topAmount] = [...byCat.entries()].sort(([, a], [, b]) => b - a)[0]!;
      findings.push({
        key: 'top-category',
        headline: `Most of it goes on ${topCat}`,
        detail: `${fmt(Math.round(topAmount * 100) / 100)} — ${Math.round((topAmount / total) * 100)}% of everything logged`,
      });

      let weekend = 0;
      for (const e of entries) {
        const day = new Date(e.at).getDay();
        if (day === 5 || day === 6) weekend += e.amount;
      }
      findings.push({
        key: 'weekend',
        headline: `${Math.round((weekend / total) * 100)}% lands on Fri–Sat`,
        detail: `${fmt(Math.round(weekend * 100) / 100)} of ${fmt(Math.round(total * 100) / 100)}`,
      });

      const biggest = [...entries].sort((a, b) => b.amount - a.amount)[0]!;
      findings.push({
        key: 'biggest',
        headline: `Biggest single expense: ${fmt(biggest.amount)}`,
        detail: `${biggest.description} (${biggest.category})`,
      });

      const perMonth = Math.round((total / months) * 100) / 100;
      findings.push({
        key: 'average',
        headline: `Averaging ${fmt(perMonth)} a month`,
        detail: `${entries.length} entries over ${months} month(s)`,
      });

      return { findings, message: `Most of your money goes on ${topCat}.` };
    }

    // ─── SMS import ────────────────────────────────────────────────────────

    case 'budget.import-sms': {
      const text = String(args['text'] ?? '').trim();
      if (!text) return { success: false, message: 'Nothing to import.' };

      // The number comes from the text, never from the model — see extractAmount.
      const amount = extractAmount(text);
      if (amount === null || amount <= 0) {
        return { success: false, message: 'No amount found in that message.', raw: text };
      }

      const reply = await api.llm.generate(text, {
        systemPrompt: SMS_RULES,
        temperature: 0.1,
        maxTokens: 200,
      });
      const parsed = extractJson(reply);
      const direction = String(parsed?.['direction'] ?? 'unknown').toLowerCase();
      const counterparty = String(parsed?.['counterparty'] ?? '').trim();
      const isMerchant = parsed?.['isMerchant'] === true;

      const cfg = await loadConfig();
      const list = await cards();
      const selfMatch = isSelf(counterparty, cfg.ownerNames) || Boolean(findCard(list, counterparty));

      // Money moving to yourself is a transfer whichever direction it is
      // described from. Real messages name the destination by NAME, not by card
      // number, which is why the owner's name is configurable.
      if (selfMatch) {
        const t: Transfer = {
          id: randomUUID(),
          at: Date.now(),
          month: localMonth(Date.now()),
          amount,
          from: direction === 'out' ? 'your account' : counterparty || 'your account',
          to: direction === 'out' ? counterparty || 'your account' : 'your account',
        };
        await api.storage.set(transferKey(t.id), t);
        return {
          success: true,
          kind: 'transfer',
          message: `Moved ${fmt(amount)} between your own accounts. Not spending.`,
          transfer: t,
        };
      }

      // Money arriving is never spending, whoever sent it.
      if (direction === 'in') {
        return {
          success: true,
          kind: 'credit',
          message: `${fmt(amount)} received${counterparty ? ` from ${counterparty}` : ''}. Not spending.`,
        };
      }

      if (direction !== 'out') {
        // Refusing to guess beats silently recording the wrong sign.
        return {
          success: false,
          kind: 'unknown',
          message: `Could not tell whether ${fmt(amount)} went out or came in. Not recorded.`,
          raw: text,
        };
      }

      const guessed = normalizeCategory(counterparty);
      const category =
        isMerchant && KNOWN_CATEGORIES.includes(guessed as (typeof KNOWN_CATEGORIES)[number])
          ? guessed
          : 'other';

      const spend: Spend = {
        id: randomUUID(),
        at: Date.now(),
        month: localMonth(Date.now()),
        amount,
        category,
        description: counterparty || 'card payment',
        source: 'parsed',
        ...(counterparty ? { merchant: counterparty } : {}),
      };
      await api.storage.set(spendKey(spend.id), spend);
      return {
        success: true,
        kind: 'spend',
        message: `Logged ${fmt(amount)}${counterparty ? ` to ${counterparty}` : ''} under ${category}.`,
        entry: spend,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
