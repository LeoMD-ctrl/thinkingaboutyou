import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { createApp } from './src/app.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

// VAPID keys identify this server to Apple/Google push services. They come from
// the environment, or are generated once and kept next to the database.
function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(DATA_DIR, 'vapid.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys));
  return keys;
}

const keys = vapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:pense-a-toi@example.com', keys.publicKey, keys.privateKey);

const { server } = createApp({
  dataDir: DATA_DIR,
  vapidPublicKey: keys.publicKey,
  sendPush: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'high' }),
});

server.listen(PORT, () => console.log(`💗 Pense à toi → http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
