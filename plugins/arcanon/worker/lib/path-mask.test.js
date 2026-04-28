/**
 * worker/lib/path-mask.test.js — Phase 123 (PII-01, PII-07-unit).
 *
 * Pins maskHome/maskHomeDeep round-trips, idempotency, deep walk, and the
 * S1 + M1 risk mitigations from PREDECESSOR-SURFACE.md verbatim.
 *
 * Set HOME to a fixture BEFORE importing path-mask.js so the module-load
 * `process.env.HOME` read sees a stable value, not the developer's actual
 * home directory.
 *
 * Cases (12, mirrors Task A2 spec):
 *   1  — maskHome — HOME prefix replaced with ~
 *   2  — maskHome — no prefix passes through
 *   3  — maskHome — exact HOME match returns ~
 *   4  — maskHome — ${HOME}other (no slash) is NOT masked (false-positive guard)
 *   5  — maskHome — non-string input passes through
 *   6  — maskHome — idempotent on already-relative paths (S1 mitigation)
 *   7  — maskHome — idempotent on already-masked paths
 *   8  — maskHomeDeep — nested object walk (no input mutation)
 *   9  — maskHomeDeep — nested array walk
 *  10  — maskHomeDeep — masks raw string values regardless of key (M1 mitigation)
 *  11  — maskHomeDeep — cycle safety
 *  12  — maskHomeDeep — non-object passes through maskHome
 */

process.env.HOME = '/tmp/fake-home-pii07';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const FAKE_HOME = '/tmp/fake-home-pii07';

const { maskHome, maskHomeDeep, PATHY_KEYS } = await import('./path-mask.js');

test('PII-07-1: maskHome — HOME prefix replaced with ~', () => {
  assert.equal(maskHome(FAKE_HOME + '/foo'), '~/foo');
  assert.equal(maskHome(FAKE_HOME + '/a/b/c.ts'), '~/a/b/c.ts');
});

test('PII-07-2: maskHome — no prefix passes through', () => {
  assert.equal(maskHome('/etc/passwd'), '/etc/passwd');
  assert.equal(maskHome('/var/log/system.log'), '/var/log/system.log');
});

test('PII-07-3: maskHome — exact HOME match returns ~', () => {
  assert.equal(maskHome(FAKE_HOME), '~');
});

test('PII-07-4: maskHome — ${HOME}other (no slash) is NOT masked', () => {
  // False-positive guard: must not match a longer prefix that happens to start with HOME.
  assert.equal(maskHome(FAKE_HOME + 'extra'), FAKE_HOME + 'extra');
  assert.equal(maskHome(FAKE_HOME + '-suffix'), FAKE_HOME + '-suffix');
});

test('PII-07-5: maskHome — non-string input passes through', () => {
  assert.equal(maskHome(null), null);
  assert.equal(maskHome(undefined), undefined);
  assert.equal(maskHome(0), 0);
  assert.equal(maskHome(false), false);
  assert.ok(Number.isNaN(maskHome(NaN)));
  const obj = { a: 1 };
  assert.equal(maskHome(obj), obj);
  const arr = [1, 2];
  assert.equal(maskHome(arr), arr);
});

test('PII-07-6: maskHome — idempotent on already-relative paths (S1 mitigation)', () => {
  // Verbatim S1 demand from PREDECESSOR-SURFACE.md: agent emits "src/" already-relative.
  assert.equal(maskHome('src/'), 'src/');
  assert.equal(maskHome('src/index.ts'), 'src/index.ts');
  assert.equal(maskHome('path/to/caller.ts:42'), 'path/to/caller.ts:42');
});

test('PII-07-7: maskHome — idempotent on already-masked paths', () => {
  assert.equal(maskHome('~/foo'), '~/foo');
  assert.equal(maskHome('~'), '~');
  // Round-trip: maskHome(maskHome(x)) === maskHome(x).
  const once = maskHome(FAKE_HOME + '/x');
  const twice = maskHome(once);
  assert.equal(once, twice);
});

test('PII-07-8: maskHomeDeep — nested object walk, no input mutation', () => {
  const input = { repo: { path: FAKE_HOME + '/r', name: 'svc' } };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = maskHomeDeep(input);
  assert.deepEqual(out, { repo: { path: '~/r', name: 'svc' } });
  // Original input must be unchanged.
  assert.deepEqual(input, snapshot);
});

test('PII-07-9: maskHomeDeep — nested array walk', () => {
  const input = [{ path: FAKE_HOME + '/a' }, { path: FAKE_HOME + '/b' }];
  const out = maskHomeDeep(input);
  assert.deepEqual(out, [{ path: '~/a' }, { path: '~/b' }]);
});

test('PII-07-10: maskHomeDeep — masks raw string values regardless of key (M1 mitigation)', () => {
  // Verbatim M1 demand from PREDECESSOR-SURFACE.md: stack frames are unkeyed strings.
  const input = { stack: FAKE_HOME + '/foo.js:42' };
  const out = maskHomeDeep(input);
  assert.deepEqual(out, { stack: '~/foo.js:42' });
  // `stack` is intentionally NOT in PATHY_KEYS — proves we mask values, not keys.
  assert.equal(PATHY_KEYS.has('stack'), false);
});

test('PII-07-11: maskHomeDeep — cycle safety (no infinite loop, no throw)', () => {
  const a = {};
  a.self = a;
  // Must complete synchronously; cycle marker semantics are impl-defined.
  const out = maskHomeDeep(a);
  assert.equal(typeof out, 'object');
});

test('PII-07-12: maskHomeDeep — non-object passes through maskHome', () => {
  assert.equal(maskHomeDeep(FAKE_HOME + '/x'), '~/x');
  assert.equal(maskHomeDeep(42), 42);
  assert.equal(maskHomeDeep(null), null);
  assert.equal(maskHomeDeep(undefined), undefined);
  assert.equal(maskHomeDeep(true), true);
});
