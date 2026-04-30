/**
 * integration.test.js — End-to-end test with a mock hub server.
 *
 * Spins up a tiny HTTP server that mimics the Arcanon Hub upload endpoint,
 * then exercises syncFindings() through the full pipeline: build payload,
 * serialize, POST, parse response. Also exercises failure → enqueue flow.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { syncFindings } from "./index.js";
import { _resetQueueDb, queueStats } from "./queue.js";
import { storeCredentials, resolveCredentials, AuthError } from "./auth.js";
import { getKeyInfo } from "./whoami.js";

function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-integration-"));
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "it@arcanon.dev"]);
  git(["config", "user.name", "Integration"]);
  fs.writeFileSync(path.join(dir, "README"), "hello");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

function startMockHub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("syncFindings happy-path round-trips through mock hub", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  process.env.ARCANON_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "arcanon-it-data-"),
  );
  process.env.ARCANON_API_KEY = "arc_it";
  process.env.ARCANON_ORG_ID = "org-it";

  let seen = null;
  const { server, url } = await startMockHub((req, res, body) => {
    seen = {
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      orgId: req.headers["x-org-id"],
      body,
    };
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scan_upload_id: "uuid-1", status: "processing", latest_payload_version: "1.0" }));
  });

  try {
    const outcome = await syncFindings({
      findings: {
        services: [{ name: "svc-a", language: "ts" }],
        connections: [{ source: "svc-a", target: "db", protocol: "rest" }],
      },
      repoPath,
      projectSlug: "integration-test",
      hubUrl: url,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.scan_upload_id, "uuid-1");
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/api/v1/scans/upload");
    assert.equal(seen.auth, "Bearer arc_it");
    // AUTH-01 wire assertion: X-Org-Id from ARCANON_ORG_ID lands on the request.
    assert.equal(seen.orgId, "org-it");
    const body = JSON.parse(seen.body);
    assert.equal(body.version, "1.0");
    assert.equal(body.metadata.tool, "claude-code");
    assert.equal(body.metadata.project_slug, "integration-test");
    assert.equal(body.findings.services.length, 1);
  } finally {
    await stopServer(server);
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_DATA_DIR;
  }
});

test("syncFindings enqueues payload when hub returns 5xx", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-data-"));
  process.env.ARCANON_DATA_DIR = dataDir;
  process.env.ARCANON_API_KEY = "arc_it";
  process.env.ARCANON_ORG_ID = "org-it";

  const { server, url } = await startMockHub((req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title: "service unavailable" }));
  });

  try {
    const outcome = await syncFindings({
      findings: {
        services: [{ name: "svc-a", language: "ts" }],
        connections: [],
      },
      repoPath,
      projectSlug: "integration-test",
      hubUrl: url,
    });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.enqueuedId, "expected retriable failure to enqueue");
    const stats = queueStats();
    assert.equal(stats.pending, 1);
  } finally {
    await stopServer(server);
    _resetQueueDb();
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_DATA_DIR;
  }
});

// ---------------------------------------------------------------------------
// AUTH-01..05 e2e: per-repo hub.org_id beats ARCANON_ORG_ID beats default_org_id;
// X-Org-Id header lands on the request. Pinning the precedence wire end-to-end.
// ---------------------------------------------------------------------------

test("AUTH-01..05 e2e: opts.orgId (per-repo override) beats env beats default — X-Org-Id lands", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  process.env.ARCANON_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "arcanon-it-data-"),
  );
  // Setup: ~/.arcanon/config.json default_org_id + ARCANON_ORG_ID env + opts.orgId.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, ".arcanon"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, ".arcanon", "config.json"),
    JSON.stringify({ api_key: "arc_x", default_org_id: "org-default" }),
  );
  process.env.ARCANON_API_KEY = "arc_x";
  process.env.ARCANON_ORG_ID = "org-env";

  let seen = null;
  const { server, url } = await startMockHub((req, res) => {
    seen = { orgId: req.headers["x-org-id"] };
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scan_upload_id: "uuid", status: "processing" }));
  });

  try {
    const outcome = await syncFindings({
      findings: { services: [{ name: "svc" }], connections: [] },
      repoPath,
      projectSlug: "p",
      hubUrl: url,
      orgId: "org-repo", // per-repo override (this is what manager.js threads through)
    });
    assert.equal(outcome.ok, true);
    assert.equal(
      seen.orgId,
      "org-repo",
      "per-repo opts.orgId must beat ARCANON_ORG_ID env AND default_org_id home-config",
    );
  } finally {
    await stopServer(server);
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_DATA_DIR;
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("AUTH-01..05 e2e: ARCANON_ORG_ID env beats default_org_id when opts.orgId is omitted", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  process.env.ARCANON_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "arcanon-it-data-"),
  );
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, ".arcanon"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, ".arcanon", "config.json"),
    JSON.stringify({ api_key: "arc_x", default_org_id: "org-default" }),
  );
  process.env.ARCANON_API_KEY = "arc_x";
  process.env.ARCANON_ORG_ID = "org-env";

  let seen = null;
  const { server, url } = await startMockHub((req, res) => {
    seen = { orgId: req.headers["x-org-id"] };
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scan_upload_id: "uuid", status: "processing" }));
  });

  try {
    const outcome = await syncFindings({
      findings: { services: [{ name: "svc" }], connections: [] },
      repoPath,
      projectSlug: "p",
      hubUrl: url,
      // No opts.orgId — env should win.
    });
    assert.equal(outcome.ok, true);
    assert.equal(seen.orgId, "org-env", "ARCANON_ORG_ID env must beat default_org_id");
  } finally {
    await stopServer(server);
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_DATA_DIR;
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("AUTH-01..05 e2e: ~/.arcanon/config.json default_org_id is the final fallback", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  process.env.ARCANON_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "arcanon-it-data-"),
  );
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, ".arcanon"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, ".arcanon", "config.json"),
    JSON.stringify({ api_key: "arc_x", default_org_id: "org-default" }),
  );
  // Note: NOT setting ARCANON_ORG_ID. ARCANON_API_KEY also NOT set so
  // the home-config api_key path is exercised.
  delete process.env.ARCANON_ORG_ID;
  delete process.env.ARCANON_API_KEY;
  delete process.env.ARCANON_API_TOKEN;

  let seen = null;
  const { server, url } = await startMockHub((req, res) => {
    seen = { orgId: req.headers["x-org-id"], auth: req.headers.authorization };
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scan_upload_id: "uuid", status: "processing" }));
  });

  try {
    const outcome = await syncFindings({
      findings: { services: [{ name: "svc" }], connections: [] },
      repoPath,
      projectSlug: "p",
      hubUrl: url,
      // No opts.orgId, no env — default_org_id wins.
    });
    assert.equal(outcome.ok, true);
    assert.equal(seen.orgId, "org-default", "default_org_id must be the final fallback");
    assert.equal(seen.auth, "Bearer arc_x", "api_key from home-config must be used");
  } finally {
    await stopServer(server);
    delete process.env.ARCANON_DATA_DIR;
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AUTH-10 / Phase 126: Login flow integration — storeCredentials → resolveCredentials
// round-trip + getKeyInfo auto-select. cmdLogin itself uses process.exit() and
// can't be unit-called; these tests pin the underlying primitives that cmdLogin
// composes (whoami → store → resolve), which is the contract under test.
// ---------------------------------------------------------------------------

async function withTempHome(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    return await fn(tmp);
  } finally {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("AUTH-10 L1: /arcanon:login --org-id round-trips through storeCredentials → resolveCredentials", async () => {
  await withTempHome(async (tmpHome) => {
    const originalOrgEnv = process.env.ARCANON_ORG_ID;
    const originalKeyEnv = process.env.ARCANON_API_KEY;
    const originalTokenEnv = process.env.ARCANON_API_TOKEN;
    const originalHubEnv = process.env.ARCANON_HUB_URL;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_API_TOKEN;
    delete process.env.ARCANON_HUB_URL;

    try {
      const file = storeCredentials("arc_login", {
        hubUrl: "https://hub.arcanon.test",
        defaultOrgId: "00000000-0000-0000-0000-000000000042",
      });
      assert.ok(
        file.startsWith(tmpHome),
        `config path must live under tmp HOME (got ${file}, tmpHome=${tmpHome})`,
      );
      const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(persisted.api_key, "arc_login");
      assert.equal(persisted.hub_url, "https://hub.arcanon.test");
      assert.equal(persisted.default_org_id, "00000000-0000-0000-0000-000000000042");

      const creds = resolveCredentials();
      assert.equal(creds.apiKey, "arc_login");
      assert.equal(creds.hubUrl, "https://hub.arcanon.test");
      assert.equal(creds.orgId, "00000000-0000-0000-0000-000000000042");
      assert.equal(creds.source, "home-config");
    } finally {
      if (originalOrgEnv !== undefined) process.env.ARCANON_ORG_ID = originalOrgEnv;
      if (originalKeyEnv !== undefined) process.env.ARCANON_API_KEY = originalKeyEnv;
      if (originalTokenEnv !== undefined) process.env.ARCANON_API_TOKEN = originalTokenEnv;
      if (originalHubEnv !== undefined) process.env.ARCANON_HUB_URL = originalHubEnv;
    }
  });
});

test("AUTH-10 L2: /arcanon:login WITHOUT --org-id calls whoami and auto-selects on N=1 grant", async () => {
  await withTempHome(async () => {
    const originalOrgEnv = process.env.ARCANON_ORG_ID;
    const originalKeyEnv = process.env.ARCANON_API_KEY;
    const originalTokenEnv = process.env.ARCANON_API_TOKEN;
    const originalHubEnv = process.env.ARCANON_HUB_URL;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_API_TOKEN;
    delete process.env.ARCANON_HUB_URL;

    let whoamiHit = false;
    const { server, url } = await startMockHub((req, res) => {
      if (req.url === "/api/v1/auth/whoami") {
        whoamiHit = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            user_id: "u-only",
            key_id: "k-only",
            scopes: ["scan:write"],
            grants: [{ org_id: "11111111-1111-1111-1111-111111111111", role: "member" }],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const keyInfo = await getKeyInfo("arc_test", url);
      assert.equal(whoamiHit, true, "whoami endpoint must be called when --org-id is omitted");
      assert.equal(keyInfo.grants.length, 1);
      const autoSelected = keyInfo.grants[0].org_id;
      assert.equal(autoSelected, "11111111-1111-1111-1111-111111111111");

      storeCredentials("arc_test", { hubUrl: url, defaultOrgId: autoSelected });

      const creds = resolveCredentials();
      assert.equal(
        creds.orgId,
        "11111111-1111-1111-1111-111111111111",
        "auto-selected org_id from whoami N=1 grant must round-trip through home-config",
      );
      assert.equal(creds.apiKey, "arc_test");
    } finally {
      await stopServer(server);
      if (originalOrgEnv !== undefined) process.env.ARCANON_ORG_ID = originalOrgEnv;
      if (originalKeyEnv !== undefined) process.env.ARCANON_API_KEY = originalKeyEnv;
      if (originalTokenEnv !== undefined) process.env.ARCANON_API_TOKEN = originalTokenEnv;
      if (originalHubEnv !== undefined) process.env.ARCANON_HUB_URL = originalHubEnv;
    }
  });
});

// NOTE: Plan 126-01 Test 8 (multi-grant AskUserQuestion mock) is intentionally
// SKIPPED. cmdLogin in plugins/arcanon/worker/cli/hub.js uses process.exit(7)
// + an `__ARCANON_GRANT_PROMPT__` stdout sentinel; the markdown layer handles
// the AskUserQuestion prompt and re-invokes cmdLogin with --org-id <chosen>.
// There is no in-process injectable seam for AskUserQuestion. Pinning the
// multi-grant prompt requires an end-to-end test against the deployed hub
// (Phase 127 VER-04 manual e2e walkthrough). The N=1 auto-select path above
// exercises the same whoami → storeCredentials chain.

test("syncFindings surfaces 422 without enqueueing", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-data-"));
  process.env.ARCANON_DATA_DIR = dataDir;
  process.env.ARCANON_API_KEY = "arc_it";
  process.env.ARCANON_ORG_ID = "org-it";

  const { server, url } = await startMockHub((req, res) => {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title: "validation failed", detail: "bad tool" }));
  });

  try {
    const outcome = await syncFindings({
      findings: { services: [{ name: "svc" }], connections: [] },
      repoPath,
      projectSlug: "it",
      hubUrl: url,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.enqueuedId, undefined, "422 must not enqueue");
    const stats = queueStats();
    assert.equal(stats.pending, 0);
  } finally {
    await stopServer(server);
    _resetQueueDb();
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_ORG_ID;
    delete process.env.ARCANON_DATA_DIR;
  }
});
