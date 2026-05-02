/**
 * whoami.test.js — Tests for  GET /api/v1/auth/whoami client.
 *
 * Uses a fakeFetch (no real network) so all tests pass regardless of
 * arcanon-hub  deploy timing.   will exercise the
 * end-to-end login flow against a real hub.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { getKeyInfo, WHOAMI_PATH } from "./whoami.js";
import { AuthError } from "./auth.js";
import { HubError } from "./client.js";

const BASE_URL = "https://api.arcanon.test";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Test W1 — 200 returns parsed grants verbatim
test("getKeyInfo returns parsed {user_id, key_id, scopes, grants} on 200", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, {
      user_id: "u1",
      key_id: "k1",
      scopes: ["read", "write"],
      grants: [{ org_id: "o1", org_name: "Acme" }],
    });
  const info = await getKeyInfo("arc_x", BASE_URL, { fetchImpl });
  assert.equal(info.user_id, "u1");
  assert.equal(info.key_id, "k1");
  assert.deepEqual(info.scopes, ["read", "write"]);
  assert.equal(info.grants.length, 1);
  assert.equal(info.grants[0].org_id, "o1");
  assert.equal(info.grants[0].org_name, "Acme");
});

// Test W2 — 401 throws AuthError with key preview (never full key)
test("getKeyInfo on 401 throws AuthError with key preview, never full key", async () => {
  const fetchImpl = async () => jsonResponse(401, { title: "invalid key" });
  let caught = null;
  try {
    await getKeyInfo("arc_supersecret_key_value", BASE_URL, { fetchImpl });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof AuthError, "expected AuthError");
  // Preview should appear; full key should NOT.
  assert.ok(
    !caught.message.includes("arc_supersecret_key_value"),
    `error message must NOT contain the full key; got: ${caught.message}`,
  );
  // Preview format check: starts with "arc_" prefix and has the key preview tail.
  assert.ok(
    caught.message.includes("arc_") && caught.message.includes("alue"),
    `expected key preview in error; got: ${caught.message}`,
  );
});

// Test W3 — 403 throws AuthError
test("getKeyInfo on 403 throws AuthError", async () => {
  const fetchImpl = async () => jsonResponse(403, { title: "forbidden" });
  await assert.rejects(
    () => getKeyInfo("arc_x", BASE_URL, { fetchImpl }),
    (err) => {
      assert.ok(err instanceof AuthError);
      return true;
    },
  );
});

// Test W4 — network error wraps to HubError(retriable=true) with underlying message
test("getKeyInfo on network error throws HubError(retriable=true) including underlying message", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () => getKeyInfo("arc_x", BASE_URL, { fetchImpl }),
    (err) => {
      assert.ok(err instanceof HubError, "expected HubError");
      assert.equal(err.retriable, true);
      assert.ok(
        err.message.includes("ECONNRESET"),
        `expected underlying error in message; got: ${err.message}`,
      );
      return true;
    },
  );
});

// Test W5 — 500 throws HubError(status=500, retriable=true)
test("getKeyInfo on 500 throws HubError(status=500, retriable=true)", async () => {
  const fetchImpl = async () => jsonResponse(500, { title: "internal error" });
  await assert.rejects(
    () => getKeyInfo("arc_x", BASE_URL, { fetchImpl }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.status, 500);
      assert.equal(err.retriable, true);
      return true;
    },
  );
});

// Test W6 — request shape: GET, Bearer auth, NO X-Org-Id (chicken-and-egg avoided)
test("getKeyInfo issues GET with Bearer auth and NO X-Org-Id header", async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, {
      user_id: "u",
      key_id: "k",
      scopes: [],
      grants: [],
    });
  };
  await getKeyInfo("arc_x", BASE_URL, { fetchImpl });
  assert.equal(captured.init.method, "GET");
  assert.ok(captured.url.endsWith(WHOAMI_PATH), `url should end with ${WHOAMI_PATH}; got: ${captured.url}`);
  assert.equal(captured.init.headers.Authorization, "Bearer arc_x");
  assert.equal(captured.init.headers.Accept, "application/json");
  // Critical: whoami discovers org_id, so it cannot require X-Org-Id.
  assert.equal(
    captured.init.headers["X-Org-Id"],
    undefined,
    "whoami request must NOT carry X-Org-Id (chicken-and-egg)",
  );
});

// Test W7 — empty grants array passes through verbatim ( decides UX)
test("getKeyInfo returns empty grants array verbatim", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, {
      user_id: "u",
      key_id: "k",
      scopes: ["read"],
      grants: [],
    });
  const info = await getKeyInfo("arc_x", BASE_URL, { fetchImpl });
  assert.deepEqual(info.grants, []);
  assert.equal(info.scopes.length, 1);
});
