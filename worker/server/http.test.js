import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpServer } from "./http.js";

const mockQE = {
  getGraph: () => ({ nodes: [{ id: 1, name: "svc-a" }], edges: [] }),
  getImpact: (ep) => ({ affected: [{ id: 1, name: "svc-b" }] }),
  getService: (name) =>
    name === "svc-a"
      ? { service: { id: 1, name: "svc-a" }, upstream: [], downstream: [] }
      : null,
  getVersions: () => [{ id: 1, created_at: "2026-01-01", label: "v1" }],
};

// Helper: create server with port 0 (no real TCP socket, inject only)
async function makeServer(qe = mockQE) {
  const server = await createHttpServer(qe, { port: 0 });
  return server;
}

test("GET /api/readiness returns 200 with {status: ok} when queryEngine is provided", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "ok");
  await server.close();
});

test("GET /api/readiness returns 200 even when queryEngine is null", async () => {
  const server = await makeServer(null);
  const res = await server.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "ok");
  await server.close();
});

test("GET /graph returns graph data from queryEngine", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/graph" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body.nodes), "nodes should be array");
  assert.ok(Array.isArray(body.edges), "edges should be array");
  assert.equal(body.nodes[0].name, "svc-a");
  await server.close();
});

test("GET /graph returns 503 when queryEngine is null", async () => {
  const server = await makeServer(null);
  const res = await server.inject({ method: "GET", url: "/graph" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "No map data yet");
  await server.close();
});

test("GET /impact?change=foo returns impact result", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/impact?change=foo" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body.affected), "affected should be array");
  assert.equal(body.affected[0].name, "svc-b");
  await server.close();
});

test("GET /impact without change param returns 400", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/impact" });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "change param required");
  await server.close();
});

test("GET /impact returns 503 when queryEngine is null", async () => {
  const server = await makeServer(null);
  const res = await server.inject({ method: "GET", url: "/impact?change=foo" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "No map data yet");
  await server.close();
});

test("GET /service/svc-a returns service details", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/service/svc-a" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.service.name, "svc-a");
  assert.ok(Array.isArray(body.upstream));
  assert.ok(Array.isArray(body.downstream));
  await server.close();
});

test("GET /service/unknown returns 404 when service not found", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/service/unknown" });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "Service not found");
  await server.close();
});

test("GET /service/:name returns 503 when queryEngine is null", async () => {
  const server = await makeServer(null);
  const res = await server.inject({ method: "GET", url: "/service/svc-a" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "No map data yet");
  await server.close();
});

test("POST /scan returns 202 with status started", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "POST", url: "/scan" });
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "started");
  assert.equal(body.message, "Scan triggered");
  await server.close();
});

test("GET /versions returns versions array", async () => {
  const server = await makeServer();
  const res = await server.inject({ method: "GET", url: "/versions" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.ok(Array.isArray(body), "versions should be array");
  assert.equal(body[0].label, "v1");
  await server.close();
});

test("GET /versions returns 503 when queryEngine is null", async () => {
  const server = await makeServer(null);
  const res = await server.inject({ method: "GET", url: "/versions" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, "No map data yet");
  await server.close();
});
