/**
 * Which workspace a skill operates on.
 *
 * Precedence: what you just said > what you were last using > what you
 * configured > the only one there is. Ambiguity is an error that lists the
 * options, never a silent guess — picking the wrong workspace writes a work
 * item somewhere nobody will look for it.
 */

import type { Workspace } from './types.js';

export interface ResolveOptions {
  explicitKey?: string;
  stored: number | null;
  defaultKey: string;
  all: Workspace[];
}

export interface Resolved {
  id: number;
  source: 'explicit' | 'stored' | 'default' | 'only';
}

function byKey(all: Workspace[], key: string): Workspace | undefined {
  const needle = key.trim().toLowerCase();
  return all.find((w) => w.key.toLowerCase() === needle);
}

export function resolveWorkspaceId(opts: ResolveOptions): Resolved {
  const { explicitKey, stored, defaultKey, all } = opts;

  if (all.length === 0) {
    throw new Error('Workspace: you are not a member of any workspace.');
  }

  if (explicitKey !== undefined && explicitKey.trim() !== '') {
    const hit = byKey(all, explicitKey);
    if (hit === undefined) {
      throw new Error(
        `Workspace: no workspace with key "${explicitKey}". You are in: ${all
          .map((w) => w.key)
          .join(', ')}.`
      );
    }
    return { id: hit.id, source: 'explicit' };
  }

  if (stored !== null && all.some((w) => w.id === stored)) {
    return { id: stored, source: 'stored' };
  }

  if (defaultKey.trim() !== '') {
    const hit = byKey(all, defaultKey);
    if (hit !== undefined) return { id: hit.id, source: 'default' };
  }

  if (all.length === 1) return { id: all[0]!.id, source: 'only' };

  throw new Error(
    `Workspace: which workspace? You are in: ${all.map((w) => w.key).join(', ')}. ` +
      `Say "use <KEY>" or set defaultWorkspaceKey in config.`
  );
}
