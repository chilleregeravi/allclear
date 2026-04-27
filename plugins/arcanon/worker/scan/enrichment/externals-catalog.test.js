/**
 * worker/scan/enrichment/externals-catalog.test.js — Phase 121 / INT-06.
 *
 * Tests the YAML loader and pure matchActor() function exposed by
 * worker/scan/enrichment/externals-catalog.js.
 *
 * Test groups:
 *   - Loader: valid file, list-form normalization, missing file, malformed
 *     YAML, malformed entry rejection, module cache.
 *   - matchActor: exact host, full URL, case-insensitive, single-asterisk
 *     wildcard (with bare-host exclusion), port match, no-match, non-string
 *     input.
 *
 * Each test calls _clearCatalogCache() in beforeEach to isolate cache state.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadShippedCatalog,
  matchActor,
  _clearCatalogCache,
} from './externals-catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve fixture paths
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'externals');
const FIXTURE_VALID = path.join(FIXTURE_DIR, 'known-externals.yaml');
const FIXTURE_MALFORMED = path.join(FIXTURE_DIR, 'malformed.yaml');

/**
 * Capture warn calls from a logger spy.
 */
function makeLoggerSpy() {
  const calls = [];
  return {
    warn: (msg) => calls.push(msg),
    _calls: calls,
  };
}

describe('externals-catalog: loadShippedCatalog', () => {
  beforeEach(() => _clearCatalogCache());

  it('loads a valid YAML and returns a NormalizedCatalog with 5 entries', () => {
    const catalog = loadShippedCatalog(FIXTURE_VALID);
    assert.ok(catalog);
    assert.ok(catalog.entries instanceof Map, 'entries is a Map');
    assert.equal(catalog.entries.size, 5);
    assert.equal(catalog.entries.get('stripe').label, 'Stripe API');
    assert.deepEqual(catalog.entries.get('stripe').hosts, ['api.stripe.com']);
    assert.deepEqual(catalog.entries.get('opentelemetry').ports, [4317, 4318]);
  });

  it('normalizes list-form entries (each item carries an `id` field)', () => {
    const tmp = path.join(os.tmpdir(), `externals-list-${Date.now()}.yaml`);
    fs.writeFileSync(
      tmp,
      `version: 1
entries:
  - id: stripe
    label: Stripe API
    hosts: ["api.stripe.com"]
  - id: github
    label: GitHub API
    hosts: ["api.github.com"]
`,
      'utf8',
    );
    try {
      const catalog = loadShippedCatalog(tmp);
      assert.equal(catalog.entries.size, 2, 'list-form normalizes to map shape');
      assert.equal(catalog.entries.get('stripe').label, 'Stripe API');
      assert.equal(catalog.entries.get('github').label, 'GitHub API');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('returns empty entries (no throw) when the file is missing', () => {
    const logger = makeLoggerSpy();
    const catalog = loadShippedCatalog('/does/not/exist.yaml', logger);
    assert.ok(catalog.entries instanceof Map);
    assert.equal(catalog.entries.size, 0);
    assert.ok(
      logger._calls.some((m) => m.includes('not found') || m.includes('no labels')),
      'logger.warn called with a not-found message',
    );
  });

  it('returns empty entries when the YAML is malformed (parse error)', () => {
    const tmp = path.join(os.tmpdir(), `externals-malformed-${Date.now()}.yaml`);
    fs.writeFileSync(tmp, 'this is: : : not valid : yaml :\n  - oops\n  bad', 'utf8');
    try {
      const logger = makeLoggerSpy();
      const catalog = loadShippedCatalog(tmp, logger);
      assert.equal(catalog.entries.size, 0);
      assert.ok(
        logger._calls.some((m) => m.includes('parse error') || m.includes('not found')),
        'logger.warn called',
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('skips malformed entries (missing label) but loads valid ones', () => {
    const logger = makeLoggerSpy();
    const catalog = loadShippedCatalog(FIXTURE_MALFORMED, logger);
    assert.equal(catalog.entries.size, 1, 'only the valid entry is loaded');
    assert.equal(catalog.entries.get('valid').label, 'Valid Entry');
    assert.ok(
      logger._calls.some((m) => m.includes('no_label') && /label/i.test(m)),
      'logger.warn cited the missing-label entry',
    );
  });

  it('caches the parsed catalog by absolute path (second call hits cache)', () => {
    const tmp = path.join(os.tmpdir(), `externals-cache-${Date.now()}.yaml`);
    fs.writeFileSync(
      tmp,
      `version: 1
entries:
  stripe:
    label: "Stripe API"
    hosts: ["api.stripe.com"]
`,
      'utf8',
    );
    try {
      const first = loadShippedCatalog(tmp);
      assert.equal(first.entries.size, 1);

      // Mutate file content; without cache, second call would see 2 entries.
      fs.writeFileSync(
        tmp,
        `version: 1
entries:
  stripe:
    label: "Stripe API"
    hosts: ["api.stripe.com"]
  github:
    label: "GitHub API"
    hosts: ["api.github.com"]
`,
        'utf8',
      );
      const second = loadShippedCatalog(tmp);
      assert.equal(second.entries.size, 1, 'second call returns the cached parse');
      assert.strictEqual(second, first, 'cache returns the same object reference');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('externals-catalog: matchActor', () => {
  beforeEach(() => _clearCatalogCache());

  function loadFixture() {
    return loadShippedCatalog(FIXTURE_VALID);
  }

  it('exact host match', () => {
    assert.equal(matchActor('api.stripe.com', loadFixture()), 'Stripe API');
  });

  it('full URL match (extracts hostname)', () => {
    assert.equal(
      matchActor('https://api.stripe.com/v1/charges', loadFixture()),
      'Stripe API',
    );
  });

  it('case-insensitive host match', () => {
    assert.equal(matchActor('API.STRIPE.COM', loadFixture()), 'Stripe API');
  });

  it('single-asterisk wildcard matches subdomains but not bare host', () => {
    const cat = loadFixture();
    assert.equal(matchActor('foo.auth0.com', cat), 'Auth0', 'one-label subdomain matches');
    assert.equal(matchActor('a.b.auth0.com', cat), 'Auth0', 'multi-label subdomain matches');
    assert.equal(matchActor('auth0.com', cat), null, 'bare host does NOT match *.auth0.com');
    assert.equal(matchActor('foo.auth0.io', cat), null, 'wrong TLD does not match');
  });

  it('port match for catalog entries with ports', () => {
    const cat = loadFixture();
    assert.equal(
      matchActor('otel-collector:4317', cat),
      'OpenTelemetry Collector',
      'port suffix matches catalog port 4317',
    );
    assert.equal(matchActor('otel-collector:9999', cat), null, 'unknown port returns null');
  });

  it('returns null on no match', () => {
    assert.equal(matchActor('totally.unknown.host', loadFixture()), null);
  });

  it('returns null on non-string input', () => {
    const cat = loadFixture();
    assert.equal(matchActor(null, cat), null);
    assert.equal(matchActor(undefined, cat), null);
    assert.equal(matchActor(123, cat), null);
    assert.equal(matchActor({}, cat), null);
    assert.equal(matchActor('', cat), null);
  });
});
