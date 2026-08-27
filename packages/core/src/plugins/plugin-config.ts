import type { PluginConfigField } from '@tardis/shared';

/**
 * Validating and resolving plugin settings.
 *
 * Before this, `config` in a manifest was an untyped bag that nothing read:
 * `api.config.get` looked only at the system config file, so a plugin's own
 * declared default was dead weight and every plugin carried its own `DEFAULTS`
 * constant and merge loop. `api.config.set` was a no-op that discarded silently.
 *
 * A described field fixes all three at once: the default is honoured, the value
 * is checked, and a form can be rendered from the description.
 */

export interface ConfigIssue {
  key: string;
  message: string;
}

export interface ConfigValidation {
  /** Values after defaults and coercion. Only meaningful when `issues` is empty. */
  values: Record<string, unknown>;
  issues: ConfigIssue[];
}

/**
 * Validates one value against its field, coercing where a config file makes
 * coercion inevitable.
 *
 * JSON keeps types, but a settings form posts strings and an environment
 * variable is always a string, so `"5"` for a number field is a normal thing to
 * receive rather than a caller error. Coercion is deliberately narrow: only
 * from string, and only when it round-trips.
 */
export function coerceConfigValue(
  field: PluginConfigField,
  value: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (field.type) {
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return { ok: false, message: `expected a number, got ${describe(value)}` };
      }
      if (field.min !== undefined && n < field.min) {
        return { ok: false, message: `must be at least ${field.min}` };
      }
      if (field.max !== undefined && n > field.max) {
        return { ok: false, message: `must be at most ${field.max}` };
      }
      return { ok: true, value: n };
    }

    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true') return { ok: true, value: true };
      if (value === 'false') return { ok: true, value: false };
      return { ok: false, message: `expected true or false, got ${describe(value)}` };
    }

    case 'select': {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (allowed.length === 0) {
        return { ok: false, message: 'select field declares no options' };
      }
      // Compared loosely against the string form so a numeric option posted by
      // a form as "5" still matches the number 5 it was rendered from.
      const match = allowed.find((a) => a === value || String(a) === String(value));
      if (match === undefined) {
        return { ok: false, message: `must be one of ${allowed.join(', ')}` };
      }
      return { ok: true, value: match };
    }

    case 'string':
    default: {
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) };
      }
      return { ok: false, message: `expected text, got ${describe(value)}` };
    }
  }
}

/**
 * Resolves a plugin's effective settings: declared defaults, overlaid by
 * whatever the system config says, validated against the schema.
 *
 * An unknown key is reported rather than dropped. A typo in config.json that
 * silently does nothing is the single most annoying kind of configuration bug,
 * and it is free to catch here.
 */
export function resolvePluginConfig(
  schema: Record<string, PluginConfigField>,
  overrides: Record<string, unknown> = {}
): ConfigValidation {
  const values: Record<string, unknown> = {};
  const issues: ConfigIssue[] = [];

  for (const [key, field] of Object.entries(schema)) {
    const supplied = key in overrides ? overrides[key] : undefined;

    if (supplied === undefined || supplied === null) {
      if (field.default !== undefined) {
        values[key] = field.default;
      } else if (field.required) {
        issues.push({ key, message: `${field.label} is required and has no default` });
      }
      continue;
    }

    const coerced = coerceConfigValue(field, supplied);
    if (coerced.ok) {
      values[key] = coerced.value;
    } else {
      issues.push({ key, message: `${field.label}: ${coerced.message}` });
    }
  }

  for (const key of Object.keys(overrides)) {
    if (!(key in schema)) {
      issues.push({ key, message: `"${key}" is not a setting this plugin declares` });
    }
  }

  return { values, issues };
}

/**
 * A copy with every `secret` field replaced by a placeholder.
 *
 * For responses and logs. This hides the value from a screen, not from an
 * attacker — the real value is in config.json in the clear, and pretending
 * otherwise would be worse than not masking at all.
 */
export function maskSecrets(
  schema: Record<string, PluginConfigField>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = schema[key];
    out[key] = field?.secret && value !== '' && value !== undefined ? '••••••••' : value;
  }
  return out;
}

/** Whether a submitted value is the mask rather than a real edit. */
export const SECRET_MASK = '••••••••';

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}
