import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from './db.js';
import { QueryEngine } from './query-engine.js';
import { createHttpServer } from './http-server.js';

// ---------------------------------------------------------------------------
// 1. Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let port = 37888;
let dataDir = process.env.ALLCLEAR_DATA_DIR || path.join(os.homedir(), '.allclear');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = parseInt(args[i + 1], 10);
  if (args[i] === '--data-dir') dataDir = args[i + 1];
}

// ---------------------------------------------------------------------------
// 2. Read settings.json for ALLCLEAR_LOG_LEVEL and port override
// ---------------------------------------------------------------------------
let logLevel = 'INFO';
try {
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  if (settings.ALLCLEAR_LOG_LEVEL) logLevel = settings.ALLCLEAR_LOG_LEVEL;
  if (settings.ALLCLEAR_WORKER_PORT) port = parseInt(settings.ALLCLEAR_WORKER_PORT, 10);
} catch {
  // Settings file absent or unreadable — use defaults
}

// ---------------------------------------------------------------------------
// 3. Create data dir and logs dir
// ---------------------------------------------------------------------------
fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

// ---------------------------------------------------------------------------
// 4. Write PID file immediately
// ---------------------------------------------------------------------------
const PID_FILE = path.join(dataDir, 'worker.pid');
const PORT_FILE = path.join(dataDir, 'worker.port');
fs.writeFileSync(PID_FILE, String(process.pid));

// ---------------------------------------------------------------------------
// 5. Structured logger
// ---------------------------------------------------------------------------
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function log(level, msg, extra = {}) {
  if (LEVELS[level] < LEVELS[logLevel]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    pid: process.pid,
    port,
    ...extra,
  });
  const logFile = path.join(dataDir, 'logs', 'worker.log');
  fs.appendFileSync(logFile, line + '\n');
  process.stderr.write(line + '\n');
}

// ---------------------------------------------------------------------------
// 6. Initialize DB and query engine
// ---------------------------------------------------------------------------
let queryEngine = null;
try {
  const db = openDb();
  queryEngine = new QueryEngine(db);
  log('INFO', 'database initialized');
} catch (err) {
  log('WARN', 'database initialization failed — routes will return 503', { error: err.message });
  // Worker still starts — /api/readiness works, data routes return 503
}

// ---------------------------------------------------------------------------
// 7. Create HTTP server with all routes (readiness, graph, impact, scan, etc.)
// ---------------------------------------------------------------------------
const app = await createHttpServer(queryEngine, { port });
fs.writeFileSync(PORT_FILE, String(port));
log('INFO', 'worker started', { port, db: queryEngine ? 'connected' : 'unavailable' });

// ---------------------------------------------------------------------------
// 8. Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  log('INFO', `received ${signal}, shutting down`);
  app.close(() => {
    try { fs.rmSync(PID_FILE, { force: true }); } catch {}
    try { fs.rmSync(PORT_FILE, { force: true }); } catch {}
    log('INFO', 'worker stopped');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
