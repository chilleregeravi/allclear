import test from "node:test";
import assert from "node:assert/strict";

import { uploadScan, HubError, UPLOAD_PATH } from "./client.js";

const BASE_URL = "https://api.arcanon.test";

function mkPayload() {
  return {
    version: "1.0",
    metadata: {
      tool: "claude-code",
      repo_name: "mock",
      commit_sha: "0".repeat(40),
      scan_mode: "full",
    },
    findings: { services: [{ name: "svc" }], connections: [], schemas: [], actors: [] },
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("uploadScan sends Bearer auth and JSON body to /api/v1/scans/upload", async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(202, { scan_upload_id: "abc", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    orgId: "org-test",
    fetchImpl,
  });
  assert.equal(res.scan_upload_id, "abc");
  assert.ok(captured.url.endsWith(UPLOAD_PATH));
  assert.equal(captured.init.headers.Authorization, "Bearer arc_test");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
  assert.equal(captured.init.method, "POST");
});

test("uploadScan treats 409 as a successful idempotent hit", async () => {
  const fetchImpl = async () =>
    jsonResponse(409, { scan_upload_id: "existing", status: "completed" });
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    orgId: "org-test",
    fetchImpl,
  });
  assert.equal(res.scan_upload_id, "existing");
});

test("uploadScan retries on 503 and eventually succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3)
      return jsonResponse(503, { title: "down", detail: "backend unavailable" });
    return jsonResponse(202, { scan_upload_id: "ok", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    orgId: "org-test",
    fetchImpl,
    backoffsMs: [0, 0, 0],
  });
  assert.equal(calls, 3);
  assert.equal(res.scan_upload_id, "ok");
});

test("uploadScan honors Retry-After on 429", async () => {
  let calls = 0;
  const started = Date.now();
  const fetchImpl = async () => {
    calls++;
    if (calls === 1)
      return jsonResponse(429, { detail: "slow down" }, { "Retry-After": "0" });
    return jsonResponse(202, { scan_upload_id: "ok", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    orgId: "org-test",
    fetchImpl,
    backoffsMs: [0, 0, 0],
  });
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 1000);
  assert.equal(res.scan_upload_id, "ok");
});

test("uploadScan fails fast on 4xx (non-429)", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(422, { title: "validation failed", detail: "bad field" });
  };
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        orgId: "org-test",
        fetchImpl,
        backoffsMs: [0, 0, 0],
      }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.status, 422);
      assert.equal(err.retriable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("uploadScan treats network errors as retriable", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        orgId: "org-test",
        fetchImpl,
        backoffsMs: [0, 0, 0],
      }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.retriable, true);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("uploadScan validates apiKey and hubUrl are present", async () => {
  const fetchImpl = async () => jsonResponse(202, {});
  await assert.rejects(
    () => uploadScan(mkPayload(), { hubUrl: BASE_URL, fetchImpl }),
    /apiKey is required/,
  );
  await assert.rejects(
    () => uploadScan(mkPayload(), { apiKey: "arc_x", fetchImpl }),
    /hubUrl is required/,
  );
});

// Test C1 — X-Org-Id header is sent on every upload
test("uploadScan sends X-Org-Id header when orgId is provided", async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(202, { scan_upload_id: "abc", status: "processing" });
  };
  await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    orgId: "org-1",
    fetchImpl,
  });
  assert.equal(captured.init.headers["X-Org-Id"], "org-1");
});

// Test C2 — missing orgId throws HubError BEFORE any fetch invocation
test("missing orgId throws HubError(status=400, code='missing_org_id') before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(202, {});
  };
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        // no orgId
        fetchImpl,
      }),
    (err) => {
      assert.ok(err instanceof HubError, "expected HubError");
      assert.equal(err.status, 400);
      assert.equal(err.code, "missing_org_id");
      assert.equal(err.retriable, false);
      return true;
    },
  );
  // Critical: throw must happen BEFORE the network attempt.
  assert.equal(calls, 0, "fakeFetch must NOT be called when orgId is missing");
});

// Test C3 — HubError gains a .code field (additive, default null)
test("HubError.code defaults to null when no code is passed", () => {
  const err = new HubError("some message", { status: 500 });
  assert.equal(err.code, null);
  // Existing fields unchanged.
  assert.equal(err.status, 500);
  assert.equal(err.retriable, false);
  assert.equal(err.body, null);
  assert.equal(err.attempts, null);
});

// Test C4 — body.title fallback preserved (forward-compat with codes the plugin doesn't recognize)
test("4xx response with body.title still surfaces title in error message", async () => {
  const fetchImpl = async () =>
    jsonResponse(422, { title: "validation failed", detail: "bad field", code: "future_unknown_code" });
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        orgId: "org-1",
        fetchImpl,
        backoffsMs: [0, 0, 0],
      }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.status, 422);
      assert.ok(
        err.message.includes("validation failed"),
        `expected body.title in error message; got: ${err.message}`,
      );
      return true;
    },
  );
});

// Each of the 7 RFC 7807 server error codes must surface as
// its own HubError with .code populated and a recognisable user message.
// Substring matching (NOT exact equality) so  copy edits don't fail
// the regression suite. This is the auth-test-suite gate (REQ ).
test("7 server error codes each surface a distinct HubError with .code populated", async () => {
  const CASES = [
    { code: "missing_x_org_id", status: 400, expectedSubstring: "x-org-id" },
    { code: "invalid_x_org_id", status: 400, expectedSubstring: "uuid" },
    { code: "insufficient_scope", status: 403, expectedSubstring: "scope" },
    { code: "key_not_authorized_for_org", status: 403, expectedSubstring: "not authorized" },
    { code: "not_a_member", status: 403, expectedSubstring: "member" },
    { code: "forbidden_scan", status: 403, expectedSubstring: "forbidden" },
    { code: "invalid_key", status: 401, expectedSubstring: "invalid" },
  ];
  for (const { code, status, expectedSubstring } of CASES) {
    const fetchImpl = async () =>
      jsonResponse(status, {
        type: "https://errors.arcanon.dev/" + code,
        title: "auth error",
        status,
        detail: "test",
        code,
      });
    await assert.rejects(
      () =>
        uploadScan(mkPayload(), {
          apiKey: "arc_test",
          hubUrl: BASE_URL,
          orgId: "org-1",
          fetchImpl,
          backoffsMs: [0, 0, 0],
        }),
      (err) => {
        assert.ok(err instanceof HubError, `code=${code}: expected HubError`);
        assert.equal(err.status, status, `code=${code}: status mismatch`);
        assert.equal(err.code, code, `code=${code}: HubError.code must be populated`);
        assert.ok(
          err.message.toLowerCase().includes(expectedSubstring.toLowerCase()),
          `code=${code}: expected message to include "${expectedSubstring}"; got: ${err.message}`,
        );
        return true;
      },
    );
  }
});
