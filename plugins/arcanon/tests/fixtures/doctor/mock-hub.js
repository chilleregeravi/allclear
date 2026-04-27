#!/usr/bin/env node
// plugins/arcanon/tests/fixtures/doctor/mock-hub.js — Phase 114-03 (NAV-03).
//
// Minimal HTTP stub for /arcanon:doctor check 8 (hub credential round-trip)
// — Test 9. Listens on 127.0.0.1:37996 (sibling to the bats-doctor worker
// port 37997, the bats-list worker port 37998, and the bats-verify worker
// port 37999). Returns 200 {"version":"x"} for /api/version and 404 for
// anything else.
//
// Started in the background by tests/doctor.bats Test 9; PID written to
// $BATS_TEST_TMPDIR/mock-hub.pid for teardown. The Authorization header is
// accepted unconditionally — the goal is to verify the doctor's round-trip
// path, not the hub's auth implementation.
import http from "node:http";

const PORT = Number(process.env.MOCK_HUB_PORT || 37996);

const server = http.createServer((req, res) => {
  if (req.url === "/api/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "x" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1");
