import { Hono } from 'hono';

const health = new Hono();

const startTime = Date.now();

health.get('/', (c) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  
  return c.json({
    status: 'ok',
    uptime,
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

export default health;
