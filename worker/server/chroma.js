/**
 * worker/chroma-sync.js — ChromaDB async sync module for AllClear v2.0
 *
 * Provides optional ChromaDB vector search as a non-blocking enhancement
 * over the SQLite/FTS5 search stack. A ChromaDB outage never prevents
 * SQLite persistence — all sync is fire-and-forget.
 *
 * Exports:
 *   initChromaSync(settings, [mockClient]) — initialize and health-check
 *   syncFindings(findings)                 — async upsert, fire-and-forget safe
 *   chromaSearch(query, limit)             — semantic search, throws when unavailable
 *   isChromaAvailable()                   — returns current availability flag
 *   _resetForTest()                       — reset module state (tests only)
 *
 * Key constraints:
 *   - ChromaClient constructor NEVER throws (chromadb v3) — errors surface on heartbeat()
 *   - syncFindings never rejects — callers use .catch() for logging only
 *   - chromaSearch throws when unavailable — caller triggers fallback to FTS5
 *   - chromaAvailable is set once at startup via heartbeat(), not per-query
 */

import { ChromaClient } from "chromadb";

const COLLECTION_NAME = "allclear-impact";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let _chromaAvailable = false;

/** @type {any | null} ChromaDB collection handle */
let _collection = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current ChromaDB availability flag.
 * Set once at startup via initChromaSync().
 *
 * @returns {boolean}
 */
export function isChromaAvailable() {
  return _chromaAvailable;
}

/**
 * Initialize ChromaDB connection and set availability flag.
 *
 * If ALLCLEAR_CHROMA_MODE is empty/falsy, returns false immediately
 * without attempting any network connection.
 *
 * @param {object} settings - Settings object from worker config loader
 * @param {string} [settings.ALLCLEAR_CHROMA_MODE] - 'local' or empty string
 * @param {string} [settings.ALLCLEAR_CHROMA_HOST] - ChromaDB host (default: localhost)
 * @param {string} [settings.ALLCLEAR_CHROMA_PORT] - ChromaDB port (default: 8000)
 * @param {string} [settings.ALLCLEAR_CHROMA_SSL]  - 'true' to use HTTPS
 * @param {object} [mockClient] - Optional mock ChromaClient (for testing)
 * @returns {Promise<boolean>} true if ChromaDB is reachable and initialized
 */
export async function initChromaSync(settings = {}, mockClient = null) {
  // Guard: no ChromaDB configured → skip immediately, no connection attempt
  if (!settings.ALLCLEAR_CHROMA_MODE) {
    _chromaAvailable = false;
    return false;
  }

  try {
    let client;
    if (mockClient) {
      client = mockClient;
    } else {
      const host = settings.ALLCLEAR_CHROMA_HOST || "localhost";
      const port = parseInt(settings.ALLCLEAR_CHROMA_PORT || "8000", 10);
      const ssl = settings.ALLCLEAR_CHROMA_SSL === "true";
      const protocol = ssl ? "https" : "http";
      // ChromaClient constructor never throws (chromadb v3) — errors surface on heartbeat()
      client = new ChromaClient({ path: `${protocol}://${host}:${port}` });
    }

    // Probe connectivity — this is where connection errors surface
    await client.heartbeat();

    // Get or create the impact collection
    _collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });
    _chromaAvailable = true;
    return true;
  } catch (err) {
    process.stderr.write("[chroma] init failed: " + err.message + "\n");
    _chromaAvailable = false;
    _collection = null;
    return false;
  }
}

/**
 * Async upsert findings to the ChromaDB collection.
 * Fire-and-forget safe — never rejects. Callers use .catch() for logging only.
 *
 * Pattern from db.js persist path:
 *   syncFindings(findings).catch(err => process.stderr.write('[chroma] ' + err.message + '\n'));
 *
 * @param {{ services: Array<{ name: string, endpoints?: Array<{ path: string }> }> }} findings
 * @returns {Promise<void>}
 */
export async function syncFindings(findings) {
  // Guard: skip silently when ChromaDB is not available
  if (!_chromaAvailable || !_collection) {
    return;
  }

  try {
    const services = findings.services || [];
    const ids = [];
    const documents = [];
    const metadatas = [];

    for (const svc of services) {
      // Add each service name as a document
      const svcId = `svc:${svc.name}`;
      ids.push(svcId);
      documents.push(svc.name);
      metadatas.push({ type: "service", name: svc.name });

      // Add each endpoint path as a separate document
      for (const endpoint of svc.endpoints || []) {
        const epId = `ep:${svc.name}:${endpoint.path}`;
        ids.push(epId);
        documents.push(`${svc.name} ${endpoint.path}`);
        metadatas.push({
          type: "endpoint",
          service: svc.name,
          path: endpoint.path,
        });
      }
    }

    if (ids.length > 0) {
      await _collection.upsert({ ids, documents, metadatas });
    }
  } catch (err) {
    // Log but never rethrow — fire-and-forget contract
    process.stderr.write("[chroma] syncFindings error: " + err.message + "\n");
  }
}

/**
 * Semantic search against the ChromaDB collection.
 * Throws when ChromaDB is unavailable so the caller can trigger fallback.
 *
 * @param {string} query - Search query text
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array<{ id: string, document: string, score: number, metadata: object }>>}
 * @throws {Error} 'ChromaDB not available' when isChromaAvailable() is false
 */
export async function chromaSearch(query, limit) {
  // Intentionally throws — caller (query-engine.js) uses this to trigger FTS5 fallback
  if (!_chromaAvailable || !_collection) {
    throw new Error("ChromaDB not available");
  }

  const response = await _collection.query({
    queryTexts: [query],
    nResults: limit,
  });

  // Normalize chromadb v3 response shape to flat array
  const ids = response.ids[0] || [];
  const docs = response.documents[0] || [];
  const distances = response.distances[0] || [];
  const metas = response.metadatas[0] || [];

  return ids.map((id, i) => ({
    id,
    document: docs[i] || "",
    score: distances[i] ?? 0,
    metadata: metas[i] || {},
  }));
}

// ---------------------------------------------------------------------------
// Test helpers (not exported in production use — only for unit tests)
// ---------------------------------------------------------------------------

/**
 * Reset all module state. Used by tests to isolate each test case.
 * NOT for production use.
 */
export function _resetForTest() {
  _chromaAvailable = false;
  _collection = null;
}
