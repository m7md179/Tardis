import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest } from '@tardis/shared';

export class ManifestValidationError extends Error {
  readonly code = 'MANIFEST_VALIDATION_ERROR';
  readonly pluginDir: string;

  constructor(message: string, pluginDir: string) {
    super(message);
    this.name = 'ManifestValidationError';
    this.pluginDir = pluginDir;
  }
}

/**
 * Validate a parsed manifest object. Throws ManifestValidationError on failure.
 */
export function validateManifest(
  raw: unknown,
  pluginDir: string,
): PluginManifest {
  const result = PluginManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ManifestValidationError(
      `Invalid manifest in ${pluginDir}:\n${issues}`,
      pluginDir,
    );
  }
  return result.data;
}

/**
 * Check for duplicate tool names across multiple plugin manifests.
 * Throws if any tool name appears in more than one plugin.
 */
export function checkDuplicateToolNames(manifests: PluginManifest[]): void {
  const seen = new Map<string, string>(); // toolName → pluginName

  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      const existing = seen.get(tool.name);
      if (existing) {
        throw new ManifestValidationError(
          `Duplicate tool name "${tool.name}" found in plugins "${existing}" and "${manifest.name}"`,
          manifest.name,
        );
      }
      seen.set(tool.name, manifest.name);
    }
  }
}

const VALID_PERMISSIONS = new Set([
  'sessions:read',
  'sessions:write',
  'storage:read',
  'storage:write',
  'notifications:send',
  'http:external',
  'memory:read',
  'memory:write',
  'llm:use',
  'plugins:call',
  'db:read',
  'db:write',
]);

/**
 * Validate permission strings in a manifest.
 * Throws ManifestValidationError for unknown permissions.
 */
export function validatePermissions(manifest: PluginManifest): void {
  const unknown = manifest.permissions.filter((p) => !VALID_PERMISSIONS.has(p));
  if (unknown.length > 0) {
    throw new ManifestValidationError(
      `Plugin "${manifest.name}" declares unknown permissions: ${unknown.join(', ')}`,
      manifest.name,
    );
  }
}
