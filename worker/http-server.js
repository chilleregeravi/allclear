import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create and start a Fastify HTTP server exposing the query engine over REST.
 *
 * @param {object|null} queryEngine - Query engine instance (may be null if DB not ready)
 * @param {object} options - Server options
 * @param {number} [options.port=37888] - Port to bind (use 0 for inject-only testing)
 * @returns {Promise<FastifyInstance>}
 */
async function createHttpServer(queryEngine, options = {}) {
  const fastify = Fastify({ logger: false });

  // Register CORS for localhost dev
  await fastify.register(fastifyCors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', /^http:\/\/127\.0\.0\.1:\d+$/],
  });

  // Register static file serving from worker/ui/
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'ui'),
    prefix: '/',
    decorateReply: false,
  });

  // -----------------------------------------------------------------------
  // Routes registered in EXACT ORDER — readiness MUST be first
  // -----------------------------------------------------------------------

  // 1. GET /api/readiness — always 200, never touches queryEngine
  fastify.get('/api/readiness', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  // 2. GET /graph — returns full service dependency graph
  fastify.get('/graph', async (_request, reply) => {
    if (!queryEngine) {
      return reply.code(503).send({ error: 'No map data yet' });
    }
    try {
      const result = queryEngine.getGraph();
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // 3. GET /impact — returns services impacted by a given endpoint
  fastify.get('/impact', async (request, reply) => {
    if (!queryEngine) {
      return reply.code(503).send({ error: 'No map data yet' });
    }
    const change = request.query.change;
    if (!change) {
      return reply.code(400).send({ error: 'change param required' });
    }
    try {
      const result = queryEngine.getImpact(change);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // 4. GET /service/:name — returns service details with upstream/downstream
  fastify.get('/service/:name', async (request, reply) => {
    if (!queryEngine) {
      return reply.code(503).send({ error: 'No map data yet' });
    }
    try {
      const result = queryEngine.getService(request.params.name);
      if (result === null || result === undefined) {
        return reply.code(404).send({ error: 'Service not found' });
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // 5. POST /scan — triggers a background scan (actual logic in Phase 18)
  fastify.post('/scan', async (request, reply) => {
    if (!queryEngine) {
      return reply.code(503).send({ error: 'No map data yet — run /allclear:map first' });
    }
    try {
      const { repo_path, repo_name, repo_type, findings, commit } = request.body || {};
      if (!repo_path || !findings) {
        return reply.code(400).send({ error: 'Missing repo_path or findings in request body' });
      }
      const repoId = queryEngine.upsertRepo({
        path: repo_path,
        name: repo_name || path.basename(repo_path),
        type: repo_type || 'single',
      });
      queryEngine.persistFindings(repoId, findings, commit || null);
      return reply.code(200).send({ status: 'persisted', repo_id: repoId });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // 6. GET /versions — returns map version history
  fastify.get('/versions', async (_request, reply) => {
    if (!queryEngine) {
      return reply.code(503).send({ error: 'No map data yet' });
    }
    try {
      const result = queryEngine.getVersions();
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Start listening on 127.0.0.1 only (never 0.0.0.0)
  const port = options.port !== undefined ? options.port : 37888;

  // When port is 0 we are in inject-only test mode — skip listen
  if (port !== 0) {
    await fastify.listen({ port, host: '127.0.0.1' });
  } else {
    await fastify.ready();
  }

  return fastify;
}

export { createHttpServer };
