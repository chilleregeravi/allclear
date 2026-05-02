import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveCredentials, storeCredentials, hasCredentials, AuthError, DEFAULT_HUB_URL } from "./auth.js";

function withTempHome(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-auth-"));
  const originalHome = os.homedir;
  const originalEnvHome = process.env.HOME;
  process.env.HOME = tmp;
  os.homedir = () => tmp;
  try {
    return fn(tmp);
  } finally {
    os.homedir = originalHome;
    if (originalEnvHome !== undefined) process.env.HOME = originalEnvHome;
    else delete process.env.HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function clearEnv() {
  delete process.env.ARCANON_API_KEY;
  delete process.env.ARCANON_API_TOKEN;
  delete process.env.ARCANON_HUB_URL;
  delete process.env.ARCANON_ORG_ID;
}

test("resolveCredentials throws when nothing is configured", () => {
  withTempHome(() => {
    clearEnv();
    assert.throws(() => resolveCredentials(), AuthError);
  });
});

test("resolveCredentials honors explicit apiKey", () => {
  withTempHome(() => {
    clearEnv();
    // Provide an orgId source so the  org_id resolver succeeds.
    const { apiKey, hubUrl, source, orgId } = resolveCredentials({
      apiKey: "arc_explicit",
      orgId: "org-explicit",
    });
    assert.equal(apiKey, "arc_explicit");
    assert.equal(source, "explicit");
    assert.equal(hubUrl, DEFAULT_HUB_URL);
    assert.equal(orgId, "org-explicit");
  });
});

test("resolveCredentials reads ARCANON_API_KEY env var", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_API_KEY = "arc_env";
    process.env.ARCANON_ORG_ID = "org-env-aux";
    const { apiKey, source } = resolveCredentials();
    assert.equal(apiKey, "arc_env");
    assert.equal(source, "env");
  });
});

test("resolveCredentials falls back to ~/.arcanon/config.json", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ api_key: "arc_home", default_org_id: "org-home" }),
    );
    const { apiKey, source } = resolveCredentials();
    assert.equal(apiKey, "arc_home");
    assert.equal(source, "home-config");
  });
});

test("resolveCredentials rejects keys without arc_ prefix", () => {
  withTempHome(() => {
    clearEnv();
    assert.throws(
      () => resolveCredentials({ apiKey: "ey.not.a.jwt.but.wrong.prefix", orgId: "org-x" }),
      /must start with "arc_"/,
    );
  });
});

// Test A1 — explicit opts.orgId beats everything
test("resolveCredentials returns explicit opts.orgId verbatim", () => {
  withTempHome(() => {
    clearEnv();
    const { apiKey, hubUrl, orgId, source } = resolveCredentials({
      apiKey: "arc_x",
      hubUrl: "https://h",
      orgId: "org-explicit",
    });
    assert.equal(apiKey, "arc_x");
    assert.equal(hubUrl, "https://h");
    assert.equal(orgId, "org-explicit");
    assert.equal(source, "explicit");
  });
});

// Test A2 — ARCANON_ORG_ID env var
test("resolveCredentials reads ARCANON_ORG_ID env var", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_ORG_ID = "org-env";
    const { apiKey, orgId } = resolveCredentials({ apiKey: "arc_x" });
    assert.equal(apiKey, "arc_x");
    assert.equal(orgId, "org-env");
  });
});

// Test A3 — ~/.arcanon/config.json default_org_id
test("resolveCredentials reads default_org_id from ~/.arcanon/config.json", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ api_key: "arc_x", default_org_id: "org-cfg" }),
    );
    const { apiKey, orgId } = resolveCredentials();
    assert.equal(apiKey, "arc_x");
    assert.equal(orgId, "org-cfg");
  });
});

// Test A4 — precedence: opts.orgId > ARCANON_ORG_ID > default_org_id
test("orgId precedence — opts beats env beats config", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ api_key: "arc_x", default_org_id: "org-cfg" }),
    );
    process.env.ARCANON_ORG_ID = "org-env";

    // All three present: opts wins
    const a = resolveCredentials({ apiKey: "arc_x", orgId: "org-opts" });
    assert.equal(a.orgId, "org-opts");

    // Env + config present (no opts): env wins
    const b = resolveCredentials({ apiKey: "arc_x" });
    assert.equal(b.orgId, "org-env");

    // Config only (no opts, no env): config wins
    delete process.env.ARCANON_ORG_ID;
    const c = resolveCredentials({ apiKey: "arc_x" });
    assert.equal(c.orgId, "org-cfg");
  });
});

// Test A5 — missing orgId throws AuthError naming all 3 sources + remediation
test("missing orgId throws AuthError naming all three sources and /arcanon:login --org-id", () => {
  withTempHome(() => {
    clearEnv();
    let caught = null;
    try {
      resolveCredentials({ apiKey: "arc_x" });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof AuthError, "expected AuthError");
    const msg = caught.message;
    assert.ok(msg.includes("opts.orgId"), `message must include "opts.orgId" — got: ${msg}`);
    assert.ok(
      msg.includes("ARCANON_ORG_ID"),
      `message must include "ARCANON_ORG_ID" — got: ${msg}`,
    );
    assert.ok(
      msg.includes("default_org_id"),
      `message must include "default_org_id" — got: ${msg}`,
    );
    assert.ok(
      msg.includes("/arcanon:login --org-id"),
      `message must include "/arcanon:login --org-id" — got: ${msg}`,
    );
  });
});

// Test A6 — existing api-key-error message must not change
test("missing apiKey still throws original 'No Arcanon Hub API key found' AuthError", () => {
  withTempHome(() => {
    clearEnv();
    let caught = null;
    try {
      resolveCredentials();
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof AuthError);
    assert.ok(
      caught.message.includes("No Arcanon Hub API key found"),
      `expected api-key error message; got: ${caught.message}`,
    );
  });
});

// Test A7 — option-a guard: hasCredentials returns true when api_key resolves but org_id does NOT.
test("hasCredentials returns true on api-key-only configs (no org_id)", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_API_KEY = "arc_x";
    // No ARCANON_ORG_ID, no ~/.arcanon/config.json default_org_id, no opts.
    assert.equal(
      hasCredentials(),
      true,
      "hasCredentials must stay org_id-tolerant per C2 option-a",
    );
  });
});

test("storeCredentials writes an 0600 config file and round-trips", () => {
  withTempHome((home) => {
    clearEnv();
    const file = storeCredentials("arc_stored", { hubUrl: "https://api.arcanon.test" });
    assert.ok(file.startsWith(home));
    const stat = fs.statSync(file);
    // On POSIX, check permissions are 0600; skip on Windows.
    if (process.platform !== "win32") {
      assert.equal(stat.mode & 0o777, 0o600);
    }
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_stored");
    assert.equal(content.hub_url, "https://api.arcanon.test");

    // Provide an orgId source so the  org_id resolver succeeds.
    process.env.ARCANON_ORG_ID = "org-roundtrip";
    const { apiKey, hubUrl } = resolveCredentials();
    assert.equal(apiKey, "arc_stored");
    assert.equal(hubUrl, "https://api.arcanon.test");
  });
});

test("storeCredentials rejects keys without arc_ prefix", () => {
  withTempHome(() => {
    assert.throws(() => storeCredentials("bogus"), AuthError);
  });
});

// Test S1 — write all three fields fresh
test("storeCredentials writes api_key + hub_url + default_org_id together", () => {
  withTempHome((home) => {
    clearEnv();
    const file = storeCredentials("arc_new", {
      hubUrl: "https://h",
      defaultOrgId: "org-1",
    });
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_new");
    assert.equal(content.hub_url, "https://h");
    assert.equal(content.default_org_id, "org-1");
    assert.ok(file.startsWith(home));
  });
});

// Test S2 — C3 spread-merge: rotating api_key preserves default_org_id + hub_url
test("storeCredentials(api_key only) preserves existing default_org_id and hub_url", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        api_key: "arc_old",
        hub_url: "https://h",
        default_org_id: "org-existing",
      }),
    );
    // Rotate api_key only — no opts.hubUrl, no opts.defaultOrgId.
    storeCredentials("arc_rotated");
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_rotated", "api_key should be rotated");
    assert.equal(content.hub_url, "https://h", "hub_url must be preserved");
    assert.equal(
      content.default_org_id,
      "org-existing",
      "default_org_id must be preserved (C3 spread-merge guard)",
    );
  });
});

// Test S3 — file mode 0600 + dir mode 0700 after every write
test("storeCredentials sets file mode 0600 and dir mode 0700", () => {
  if (process.platform === "win32") return; // POSIX-only
  withTempHome((home) => {
    clearEnv();
    const file = storeCredentials("arc_x", {
      hubUrl: "https://h",
      defaultOrgId: "org-1",
    });
    const fileStat = fs.statSync(file);
    assert.equal(fileStat.mode & 0o777, 0o600, "file must be 0600");
    const dirStat = fs.statSync(path.join(home, ".arcanon"));
    assert.equal(dirStat.mode & 0o777, 0o700, "dir must be 0700");
  });
});

// Test S4 — no hub_url default-fill when opt is omitted
test("storeCredentials with no hubUrl opt does not write hub_url field", () => {
  withTempHome(() => {
    clearEnv();
    const file = storeCredentials("arc_x", { defaultOrgId: "org-2" });
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_x");
    assert.equal(content.default_org_id, "org-2");
    assert.equal(
      Object.prototype.hasOwnProperty.call(content, "hub_url"),
      false,
      "hub_url must NOT be present when no opt + no existing key",
    );
  });
});

// Test S5 — forward-compat: unknown future_field on existing config preserved
test("storeCredentials preserves unknown future fields via spread-merge", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        api_key: "x",
        hub_url: "h",
        future_field: "preserved",
      }),
    );
    storeCredentials("arc_x");
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_x");
    assert.equal(content.hub_url, "h");
    assert.equal(content.future_field, "preserved");
  });
});

test("hasCredentials returns false when nothing is configured", () => {
  withTempHome(() => {
    clearEnv();
    assert.equal(hasCredentials(), false);
  });
});

test("hasCredentials returns true when env var is set", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_API_KEY = "arc_env";
    assert.equal(hasCredentials(), true);
  });
});

test("hasCredentials returns true after storeCredentials (regression: auto-upload gate)", () => {
  // This guards the scan-manager auto-upload path: a user who ran
  // /arcanon:login but never exported ARCANON_API_KEY must still be
  // treated as authenticated.
  withTempHome(() => {
    clearEnv();
    storeCredentials("arc_fromlogin");
    assert.equal(hasCredentials(), true);
  });
});
