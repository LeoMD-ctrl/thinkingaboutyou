import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { createApp } from './src/app.js';
import { openMeteo } from './src/weather.js';

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

// FAKE_WEATHER=1 makes up the weather from the latitude (to try every kind offline):
// .0 clear, .1 cloudy, .2 overcast, .3 fog, .4 rain, .5 snow, .6 storm.
const FAKE_KINDS = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'];
const fakeWeather = async (lat) => ({ kind: FAKE_KINDS[Math.round(Math.abs(lat) * 10) % 10 % FAKE_KINDS.length], temp: 14 });

const { server } = createApp({
  dataDir: DATA_DIR,
  vapidPublicKey: keys.publicKey,
  sendPush: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'high' }),
  fetchWeather: process.env.FAKE_WEATHER ? fakeWeather : openMeteo,
});

server.listen(PORT, () => console.log(`💗 Pense à toi → http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
