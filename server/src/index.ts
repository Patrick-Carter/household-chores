import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { initDb } from './db.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = path.resolve(process.env.DB_PATH ?? 'server/data/chores.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = initDb(dbPath);
const app = createApp({ db });

app.listen(port, () => {
  console.log(`[chores] listening on :${port} (db=${dbPath})`);
});
