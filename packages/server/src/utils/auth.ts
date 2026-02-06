import { randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const API_KEYS_FILE = process.env.TARDIS_API_KEYS || '/var/lib/tardis/api_keys.json';

interface ApiKeyStore {
  keys: {
    [key: string]: {
      hash: string;
      created: string;
      lastUsed?: string;
    };
  };
}

/**
 * Generate a random API key
 */
export function generateApiKey(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Load API keys from file
 */
function loadApiKeys(): ApiKeyStore {
  if (!existsSync(API_KEYS_FILE)) {
    return { keys: {} };
  }

  try {
    const content = readFileSync(API_KEYS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load API keys:', error);
    return { keys: {} };
  }
}

/**
 * Save API keys to file
 */
function saveApiKeys(store: ApiKeyStore): void {
  const dir = dirname(API_KEYS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(API_KEYS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Validate an API key
 */
export async function validateApiKey(key: string): Promise<boolean> {
  const hash = hashApiKey(key);
  const store = loadApiKeys();

  for (const [keyName, keyData] of Object.entries(store.keys)) {
    if (keyData.hash === hash) {
      // Update last used timestamp
      keyData.lastUsed = new Date().toISOString();
      saveApiKeys(store);
      return true;
    }
  }

  return false;
}

/**
 * Add an API key
 */
export function addApiKey(key: string, name: string = 'default'): void {
  const store = loadApiKeys();
  const hash = hashApiKey(key);

  store.keys[name] = {
    hash,
    created: new Date().toISOString(),
  };

  saveApiKeys(store);
}

/**
 * Remove an API key
 */
export function removeApiKey(name: string): boolean {
  const store = loadApiKeys();

  if (store.keys[name]) {
    delete store.keys[name];
    saveApiKeys(store);
    return true;
  }

  return false;
}

/**
 * List all API key names (not the keys themselves)
 */
export function listApiKeys(): string[] {
  const store = loadApiKeys();
  return Object.keys(store.keys);
}
