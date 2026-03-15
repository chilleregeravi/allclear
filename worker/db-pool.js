/**
 * worker/db-pool.js — Per-project DB and QueryEngine pool.
 *
 * The worker is project-agnostic. It resolves the correct DB based on
 * a project root path passed in each request (?project=/path/to/repo).
 * DBs are opened on first access and cached for the worker's lifetime.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { QueryEngine } from './query-engine.js';

const dataDir = process.env.ALLCLEAR_DATA_DIR || path.join(os.homedir(), '.allclear');

/** Cache: projectRoot → QueryEngine */
const pool = new Map();

/**
 * Compute the per-project data directory.
 * @param {string} projectRoot
 * @returns {string}
 */
function projectHashDir(projectRoot) {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  return path.join(dataDir, 'projects', hash);
}

/**
 * Get or create a QueryEngine for the given project root.
 * Opens the SQLite DB on first access, caches for subsequent requests.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {QueryEngine|null} Null if no DB exists for this project.
 */
export function getQueryEngine(projectRoot) {
  if (!projectRoot) return null;

  if (pool.has(projectRoot)) {
    return pool.get(projectRoot);
  }

  const dir = projectHashDir(projectRoot);
  const dbPath = path.join(dir, 'impact-map.db');

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const qe = new QueryEngine(db);
    pool.set(projectRoot, qe);
    return qe;
  } catch (err) {
    process.stderr.write(`[db-pool] Failed to open DB for ${projectRoot}: ${err.message}\n`);
    return null;
  }
}

/**
 * List all projects that have a DB.
 * Scans ~/.allclear/projects/ for impact-map.db files.
 * @returns {Array<{hash: string, dbPath: string, size: number}>}
 */
export function listProjects() {
  const projectsDir = path.join(dataDir, 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  return fs.readdirSync(projectsDir)
    .filter(hash => fs.existsSync(path.join(projectsDir, hash, 'impact-map.db')))
    .map(hash => {
      const dbPath = path.join(projectsDir, hash, 'impact-map.db');
      const stat = fs.statSync(dbPath);
      return { hash, dbPath, size: stat.size };
    });
}
