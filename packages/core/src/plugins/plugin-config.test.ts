import { describe, it, expect } from 'bun:test';
import {
  coerceConfigValue,
  resolvePluginConfig,
  maskSecrets,
  SECRET_MASK,
} from './plugin-config.js';
import type { PluginConfigField } from '@tardis/shared';

const str = (extra: Partial<PluginConfigField> = {}): PluginConfigField => ({
  type: 'string',
  label: 'Text',
  ...extra,
});
const num = (extra: Partial<PluginConfigField> = {}): PluginConfigField => ({
  type: 'number',
  label: 'Number',
  ...extra,
});
const bool = (extra: Partial<PluginConfigField> = {}): PluginConfigField => ({
  type: 'boolean',
  label: 'Flag',
  ...extra,
});

describe('coerceConfigValue', () => {
  it('accepts a value of the declared type', () => {
    expect(coerceConfigValue(str(), 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(coerceConfigValue(num(), 5)).toEqual({ ok: true, value: 5 });
    expect(coerceConfigValue(bool(), true)).toEqual({ ok: true, value: true });
  });

  it('coerces from string, because forms and env vars only send strings', () => {
    expect(coerceConfigValue(num(), '5')).toEqual({ ok: true, value: 5 });
    expect(coerceConfigValue(bool(), 'true')).toEqual({ ok: true, value: true });
    expect(coerceConfigValue(bool(), 'false')).toEqual({ ok: true, value: false });
  });

  it('rejects a string that is not the number it claims to be', () => {
    const out = coerceConfigValue(num(), 'twelve');
    expect(out.ok).toBe(false);
  });

  it('rejects an empty string for a number rather than reading it as zero', () => {
    // A cleared form field means "unset", never "0". Silently storing zero for
    // a timeout would be a genuinely dangerous reading.
    expect(coerceConfigValue(num(), '').ok).toBe(false);
  });

  it('rejects a non-boolean string for a flag', () => {
    expect(coerceConfigValue(bool(), 'yes').ok).toBe(false);
    expect(coerceConfigValue(bool(), 1).ok).toBe(false);
  });

  it('enforces min and max', () => {
    expect(coerceConfigValue(num({ min: 1, max: 20 }), 0)).toMatchObject({ ok: false });
    expect(coerceConfigValue(num({ min: 1, max: 20 }), 21)).toMatchObject({ ok: false });
    expect(coerceConfigValue(num({ min: 1, max: 20 }), 20)).toEqual({ ok: true, value: 20 });
  });

  it('rejects a value outside a select', () => {
    const field: PluginConfigField = {
      type: 'select',
      label: 'Currency',
      options: [
        { value: 'JOD', label: 'Jordanian dinar' },
        { value: 'USD', label: 'US dollar' },
      ],
    };
    expect(coerceConfigValue(field, 'JOD')).toEqual({ ok: true, value: 'JOD' });
    expect(coerceConfigValue(field, 'GBP').ok).toBe(false);
  });

  it('matches a numeric select option submitted as a string', () => {
    // A form renders 5 and posts "5". Rejecting that would make numeric
    // options unusable from any UI.
    const field: PluginConfigField = {
      type: 'select',
      label: 'Results',
      options: [
        { value: 5, label: 'Five' },
        { value: 10, label: 'Ten' },
      ],
    };
    expect(coerceConfigValue(field, '5')).toEqual({ ok: true, value: 5 });
  });

  it('rejects a select with no options rather than accepting anything', () => {
    expect(coerceConfigValue({ type: 'select', label: 'Broken' }, 'x').ok).toBe(false);
  });
});

describe('resolvePluginConfig', () => {
  const schema = {
    searxngUrl: str({ default: 'http://localhost:8888', required: true }),
    maxResults: num({ default: 5, min: 1, max: 20 }),
    enabled: bool({ default: true }),
  };

  it('falls back to declared defaults', () => {
    // The bug this fixes: defaults in a manifest were never read, so every
    // plugin carried its own DEFAULTS constant and merge loop.
    const { values, issues } = resolvePluginConfig(schema);
    expect(issues).toEqual([]);
    expect(values).toEqual({
      searxngUrl: 'http://localhost:8888',
      maxResults: 5,
      enabled: true,
    });
  });

  it('lets the system config win', () => {
    const { values } = resolvePluginConfig(schema, { searxngUrl: 'http://searx.internal' });
    expect(values['searxngUrl']).toBe('http://searx.internal');
    expect(values['maxResults']).toBe(5);
  });

  it('reports a value the schema forbids, and keeps the rest', () => {
    const { values, issues } = resolvePluginConfig(schema, { maxResults: 500 });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.key).toBe('maxResults');
    expect(issues[0]!.message).toContain('at most 20');
    expect(values['searxngUrl']).toBe('http://localhost:8888');
  });

  it('reports a required field with nothing to fall back on', () => {
    const { issues } = resolvePluginConfig({ apiToken: str({ required: true }) });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('required');
  });

  it('accepts a required field that has a default', () => {
    expect(resolvePluginConfig({ url: str({ required: true, default: 'x' }) }).issues).toEqual([]);
  });

  it('reports a key the plugin does not declare', () => {
    // A typo in config.json that silently does nothing is the most annoying
    // kind of configuration bug, and it is free to catch here.
    const { issues } = resolvePluginConfig(schema, { searxngUrI: 'http://typo' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('not a setting this plugin declares');
  });

  it('treats null the same as absent', () => {
    // JSON has no undefined, so a config file blanks a value with null.
    const { values, issues } = resolvePluginConfig(schema, { maxResults: null });
    expect(issues).toEqual([]);
    expect(values['maxResults']).toBe(5);
  });

  it('handles a plugin with no settings at all', () => {
    expect(resolvePluginConfig({})).toEqual({ values: {}, issues: [] });
  });
});

describe('maskSecrets', () => {
  const schema = {
    apiToken: str({ secret: true }),
    searxngUrl: str(),
  };

  it('masks a secret and leaves everything else', () => {
    const masked = maskSecrets(schema, { apiToken: 'abc123', searxngUrl: 'http://x' });
    expect(masked['apiToken']).toBe(SECRET_MASK);
    expect(masked['searxngUrl']).toBe('http://x');
  });

  it('does not mask an empty secret', () => {
    // Showing bullets for a token that was never set would read as "configured"
    // when it is not — the opposite of what the mask is for.
    expect(maskSecrets(schema, { apiToken: '' })['apiToken']).toBe('');
  });
});
