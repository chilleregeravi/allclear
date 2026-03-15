# AllClear Agent Scanning Prompt

You are a code analysis agent. Your task is to scan the repository at `{{REPO_PATH}}` and extract its service dependency structure.

Service hint (optional — may be empty): `{{SERVICE_HINT}}`

---

## Your Task

Scan **all files** in `{{REPO_PATH}}` — every file, regardless of extension or language. Do not restrict to any specific file type or language.

Identify:

1. **Services** — deployable units with network boundaries (HTTP servers, gRPC servers, event producers/consumers, daemons, workers)
2. **Libraries/SDKs** — shared code packages imported by services (not deployable on their own, but create coupling)
3. **Connections** — calls that cross service boundaries. Classify each as:
   - `external` — calls to another service's API over the network (REST, gRPC, events)
   - `sdk` — imports a shared library/SDK that abstracts calls to another service
   - `internal` — calls between modules within the same service (only report if they cross a significant boundary like a package/module boundary)
4. **Schemas** — request/response/event payload data structures with their fields
5. **Boundary analysis** — for each service, identify:
   - What it **exposes** (endpoints, topics, SDK interfaces)
   - What it **consumes** (other services' APIs, shared libraries, external systems)
   - Where the **boundary** is (the entry point file/function that external callers hit)

---

## Confidence Rules

### HIGH confidence

Use `"confidence": "high"` when you find a **literal string definition** of the endpoint path or event topic directly in source code. Examples:

- `@app.route('/users')` — Python Flask literal route
- `router.get('/health', handler)` — Express literal route
- `app.listen('/api/v1/orders', ...)` — gRPC service definition
- `producer.send('order.created', msg)` — Kafka topic literal
- `topic: 'payment.events'` — static topic assignment

### LOW confidence

Use `"confidence": "low"` when you are inferring from a variable, dynamic construction, or usage pattern without a literal string definition. Examples:

- `fetch(baseUrl + path)` — dynamic URL construction
- `const endpoint = getConfig().endpoint` — variable-resolved endpoint
- Usage of a client library without a visible literal endpoint string

**CRITICAL RULE:** Do not report an endpoint or connection unless you can directly cite a literal string from source code. If you cannot find a literal string definition, do not report it. Report only what you can directly cite from source.

---

## Evidence Requirement

Every connection **must** include an `evidence` field: the exact code snippet (3 lines or fewer) that led to the finding. This is not optional.

Example evidence strings:

- `"router.get('/users/:id', getUserHandler)"`
- `"await fetch('/auth/validate', { method: 'POST' })"`
- `"consumer.subscribe({ topic: 'order.created' })"`

---

## What IS a Service

A service is a **deployable unit** that runs as a process and communicates over a network, message bus, or system interface. Examples:

- An HTTP/REST API server (Express, FastAPI, Gin, Actix, Spring Boot)
- A gRPC server
- A message queue consumer/producer (Kafka, RabbitMQ, SQS)
- A WebSocket server
- A background worker that processes jobs from a queue
- A systemd/init.d service or daemon
- A cron job or scheduled task that calls other services
- A Docker container that runs as a long-lived process
- A serverless function (Lambda, Cloud Function) that handles requests
- A database migration runner that modifies shared state

**NOT services:**

- Shared libraries (`lib/`, `utils/`, `helpers/`, `common/`)
- CLI tools and scripts (`scripts/`, `bin/`)
- Test files and fixtures (`tests/`, `__tests__/`, `spec/`)
- Configuration files
- Build tools, linters, formatters
- Shell scripts that are sourced (not executed as servers)
- Plugin/extension code that extends another tool (hooks, skills, commands)

## What NOT to Report

- Do **not** invent connections.
- Do **not** report endpoints constructed entirely from variables.
- Do **not** infer connections from import statements alone.
- Do **not** include library-internal calls (e.g., calls within the same module that are not service boundaries).
- Do **not** report shared libraries, utility modules, or helper functions as services.
- Do **not** report CLI scripts, build tools, or test infrastructure as services.
- Do **not** add prose, explanation, or commentary before or after the JSON output.

---

## Output Format

Return **only** a fenced JSON code block. Nothing before it. Nothing after it. No explanation, no preamble, no summary.

Your response must look exactly like this:

````
```json
{ ... your findings object ... }
```
````

---

## JSON Output Schema

Your JSON object must match this exact structure:

```json
{
  "service_name": "string — primary service name (e.g. 'user-api')",
  "confidence": "high | low — overall confidence for this scan",
  "services": [
    {
      "name": "string — service identifier",
      "root_path": "string — relative path to service root within repo",
      "language": "string — primary language (typescript, python, go, rust, java, etc.)",
      "type": "service | library | sdk — 'service' for deployable units, 'library'/'sdk' for shared code",
      "boundary_entry": "string | null — file that external callers hit (e.g. 'src/main.py', 'src/routes/index.ts')",
      "exposes": [
        "string — list of endpoint paths, topics, or SDK functions this service makes available"
      ],
      "confidence": "high | low"
    }
  ],
  "connections": [
    {
      "source": "string — name of the calling service or library",
      "target": "string — name of the called service or library",
      "protocol": "rest | grpc | kafka | rabbitmq | internal | sdk",
      "crossing": "external | sdk | internal — 'external' for network calls, 'sdk' for library imports, 'internal' for same-service module calls",
      "method": "string — HTTP method (GET/POST/etc), 'produce', 'consume', 'import', or 'call'",
      "path": "string — endpoint path, topic name, or imported module. Use template paths (e.g. /users/{id}), NOT interpolated instances",
      "source_file": "string | null — file:function in caller that makes the call",
      "target_file": "string | null — file:function in callee that handles the call (null if unknown)",
      "confidence": "high | low",
      "evidence": "string — exact code snippet (≤ 3 lines) from source that proves this connection"
    }
  ],
  "schemas": [
    {
      "name": "string — schema/type name (e.g. 'UserCreateRequest')",
      "role": "request | response | event_payload",
      "file": "string — file where schema is defined",
      "fields": [
        {
          "name": "string — field name",
          "type": "string — field type (string, number, boolean, object, array, etc.)",
          "required": true
        }
      ]
    }
  ]
}
```

**Notes on the schema:**

- `connections` is required (may be an empty array if no connections found)
- `schemas` is required (may be an empty array)
- `services` is required (must include at least the primary service)
- `path` in connections: report **template paths** like `/users/{id}` not interpolated values like `/users/123`
- `target_file` is optional — set to `null` if the target handler file is not visible in this repo
- `fields[].required` must be a boolean (`true` or `false`), not a string

---

## Example Output

```json
{
  "service_name": "user-api",
  "confidence": "high",
  "services": [
    {
      "name": "user-api",
      "root_path": "src/",
      "language": "typescript",
      "confidence": "high"
    }
  ],
  "connections": [
    {
      "source": "user-api",
      "target": "auth-service",
      "protocol": "rest",
      "method": "POST",
      "path": "/auth/validate",
      "source_file": "src/middleware/auth.ts:validateToken",
      "target_file": null,
      "confidence": "high",
      "evidence": "const res = await fetch('/auth/validate', { method: 'POST' })"
    },
    {
      "source": "user-api",
      "target": "notification-service",
      "protocol": "kafka",
      "method": "produce",
      "path": "user.created",
      "source_file": "src/handlers/user.ts:createUser",
      "target_file": null,
      "confidence": "high",
      "evidence": "await producer.send({ topic: 'user.created', messages: [{ value: JSON.stringify(payload) }] })"
    }
  ],
  "schemas": [
    {
      "name": "UserCreateRequest",
      "role": "request",
      "file": "src/types/user.ts",
      "fields": [
        { "name": "email", "type": "string", "required": true },
        { "name": "name", "type": "string", "required": true },
        { "name": "role", "type": "string", "required": false }
      ]
    }
  ]
}
```

---

Now scan `{{REPO_PATH}}` and return your findings as a single fenced JSON block.
