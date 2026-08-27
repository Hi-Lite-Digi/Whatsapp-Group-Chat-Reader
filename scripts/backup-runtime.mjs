import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dbPath = path.resolve(process.env.DB_PATH || './data/whatsapp_bot.db');
const authFolder = path.resolve(process.env.AUTH_FOLDER || './auth_info');
const backupRoot = path.resolve(process.env.BACKUP_DIR || './data/backups');
const retentionDays = Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFolder = path.join(backupRoot, timestamp);

fs.mkdirSync(backupFolder, { recursive: true });

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found: ${dbPath}`);
}

const database = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  await database.backup(path.join(backupFolder, 'whatsapp_bot.db'));
} finally {
  database.close();
}

if (fs.existsSync(authFolder)) {
  fs.cpSync(authFolder, path.join(backupFolder, 'auth'), {
    recursive: true,
    force: false,
    errorOnExist: true
  });
}

fs.writeFileSync(path.join(backupFolder, 'manifest.json'), JSON.stringify({
  createdAt: new Date().toISOString(),
  database: dbPath,
  authFolder,
  nodeVersion: process.version
}, null, 2));

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === timestamp) continue;
  const target = path.join(backupRoot, entry.name);
  if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
}

console.log(`Runtime backup created: ${backupFolder}`);
