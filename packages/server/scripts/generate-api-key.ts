#!/usr/bin/env bun

import { generateApiKey, addApiKey, hashApiKey } from '../src/utils/auth';

const keyName = process.argv[2] || 'default';
const apiKey = generateApiKey();

console.log('\n=== TARDIS API Key Generated ===\n');
console.log(`API Key: ${apiKey}`);
console.log(`Key Name: ${keyName}`);
console.log(`Hash: ${hashApiKey(apiKey)}`);

// Add to store
addApiKey(apiKey, keyName);

console.log('\n✓ API key saved to /var/lib/tardis/api_keys.json');
console.log('\nAdd this to your CLI config:');
console.log(`tardis config --api-key ${apiKey}`);
console.log();
