import { loadConfig } from '@tardis/core';
const config = loadConfig(process.env.HOME + '/.tardis');
console.log('Plugins configured:', Object.keys(config.plugins || {}));
console.log('Full plugins object:', config.plugins);
