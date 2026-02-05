import { join } from 'path';
import { homedir } from 'os';

/**
 * Base TARDIS directory in user's home
 * ~/.tardis/
 */
export const TARDIS_DIR = join(homedir(), '.tardis');

/**
 * Directory for active (in-progress) sessions
 * ~/.tardis/active_sessions/
 */
export const ACTIVE_SESSIONS_DIR = join(TARDIS_DIR, 'active_sessions');

/**
 * Directory for archived (completed) sessions organized by date
 * ~/.tardis/sessions/YYYY-MM-DD/
 */
export const SESSIONS_DIR = join(TARDIS_DIR, 'sessions');

/**
 * Configuration file path
 * ~/.tardis/config.json
 */
export const CONFIG_FILE = join(TARDIS_DIR, 'config.json');

/**
 * Legacy current session file path (for migration)
 * ~/.tardis/current_session.json
 */
export const LEGACY_CURRENT_SESSION_FILE = join(TARDIS_DIR, 'current_session.json');
