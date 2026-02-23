export type Permission =
  | 'sessions:read'
  | 'sessions:write'
  | 'storage:read'
  | 'storage:write'
  | 'notifications:send'
  | 'http:external'
  | 'memory:read'
  | 'memory:write'
  | 'llm:use'
  | 'plugins:call'
  | 'db:read'
  | 'db:write';

export const ALL_PERMISSIONS: ReadonlyArray<Permission> = [
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
];

export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly permission: Permission;
  readonly pluginName: string;

  constructor(pluginName: string, permission: Permission) {
    super(`Plugin "${pluginName}" does not have permission: ${permission}`);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
    this.pluginName = pluginName;
  }
}

/**
 * Runtime permission guard for plugin API calls.
 * Each PluginAPI instance holds a guard scoped to that plugin's declared permissions.
 */
export class PermissionGuard {
  private readonly grantedPermissions: ReadonlySet<string>;

  constructor(
    private readonly pluginName: string,
    permissions: string[]
  ) {
    this.grantedPermissions = new Set(permissions);
  }

  /**
   * Assert the plugin has the given permission.
   * Throws PermissionDeniedError if not granted.
   */
  assert(permission: Permission): void {
    if (!this.grantedPermissions.has(permission)) {
      throw new PermissionDeniedError(this.pluginName, permission);
    }
  }

  /**
   * Returns true if the plugin has the given permission.
   */
  has(permission: Permission): boolean {
    return this.grantedPermissions.has(permission);
  }
}
