# Ligamen Deep Scan Agent — Phase 2

You are a code analysis agent. Your task is to do a **deep scan** of the repository at `{{REPO_PATH}}` and extract its service dependency structure.

## Discovery Context (from Phase 1)

{{DISCOVERY_JSON}}

Use the discovery context above to focus your scan:

- **Only read files relevant to the detected services** — route files, handler files, client files, config files
- **Use the framework hints** to know what patterns to look for (e.g., `@app.route` for Flask, `router.get` for Express)
- **Focus on `route_files`** listed above — these contain the endpoint definitions
- **Check `proto_files` and `openapi_files`** for API contracts
- **Check `event_config_files`** for message queue topics

If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files.

---

## Your Task

Scan the relevant source files in `{{REPO_PATH}}` based on the discovery context above.

Identify (within `{{REPO_PATH}}` ONLY — do not report services from other repos):

1. **Services** — deployable units **whose source code is in this repo** with network boundaries (HTTP servers, gRPC servers, event producers/consumers, daemons, workers)
2. **Libraries/SDKs** — shared code packages **in this repo** imported by services (not deployable on their own, but create coupling)
3. **Connections** — calls that cross service boundaries. The `source` must be a service in this repo. The `target` can be an external service not in this repo. Classify each as:
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

## Type Classification

Every entry in the `services` array must have one of these types:

### `type: "service"` — Deployable units

A process that runs and communicates over a network, message bus, or system interface:

- HTTP/REST API server (Express, FastAPI, Gin, Actix, Spring Boot)
- gRPC server
- Message queue consumer/producer (Kafka, RabbitMQ, SQS)
- WebSocket server
- Background worker that processes jobs from a queue
- Daemon, systemd service, cron job
- Docker container running as a long-lived process
- Serverless function (Lambda, Cloud Function)

### `type: "library"` or `"sdk"` — Shared code

Packages imported by services, not deployable on their own:

- Shared client libraries (`@acme/sdk`, `edgeworks-sdk`)
- Internal packages (`lib/`, `packages/common`)
- SDKs that abstract calls to another service

### `type: "infra"` — Infrastructure-as-code

Repos that define deployment, configuration, or infrastructure for services:

- Kubernetes manifests (kustomize overlays, Helm charts, raw YAML)
- Terraform/OpenTofu configurations
- Docker Compose files
- CI/CD pipeline definitions that deploy services
- ArgoCD/Flux GitOps configurations

**How to detect:** Repo contains `kustomization.yaml`, `Chart.yaml`, `*.tf`, `docker-compose.yml`, `helmfile.yaml`, or directories like `overlays/`, `charts/`, `terraform/`.

### NOT any of the above

Do not report these as services, libraries, or infra:

- CLI tools and scripts (`scripts/`, `bin/`)
- Test files and fixtures (`tests/`, `__tests__/`, `spec/`)
- Build tools, linters, formatters
- Shell scripts that are sourced (not executed as servers)
- Plugin/extension code that extends another tool

## What NOT to Report

- Do **not** invent connections.
- Do **not** report endpoints constructed entirely from variables.
- Do **not** infer connections from import statements alone.
- Do **not** include library-internal calls (e.g., calls within the same module that are not service boundaries).
- Do **not** report shared libraries, utility modules, or helper functions as services.
- Do **not** report CLI scripts, build tools, or test infrastructure as services.
- Do **not** add prose, explanation, or commentary before or after the JSON output.
- Do **not** report services whose source code is NOT in `{{REPO_PATH}}`. If this repo calls an external service, that service should appear ONLY as a `target` in the `connections` array — never as an entry in the `services` array. The `services` array must contain ONLY services/libraries whose code lives inside `{{REPO_PATH}}`.
- Do **not** report a service just because it is referenced in a config file, Dockerfile, docker-compose, or deployment manifest. Only report it if its **source code** is in this repo.

---

## Service Naming Convention

The `name` field in every service object **must** be derived from the project's package manifest and formatted as **lowercase-hyphenated**. This is required to prevent false identity merges when multiple repos each happen to expose a service with a common name.

### 1. Derive the name from the package manifest

Look for the following manifest files in the repo root or service subdirectory:

| Ecosystem    | Manifest file   | Name field                                              |
|--------------|-----------------|--------------------------------------------------------|
| Node.js/npm  | `package.json`  | `"name"` field at the top level                        |
| Python       | `pyproject.toml`| `[project]` → `name`; fallback: top-level package name from `setup.py` |
| Go           | `go.mod`        | Last path segment of the `module` declaration           |
| Rust         | `Cargo.toml`    | `[package]` → `name`                                   |

If no manifest file is found, use the **repository directory basename** as the service name.

### 2. Format as lowercase-hyphenated

Apply these transformations in order:

1. Strip any leading `@scope/` prefix (e.g., `@company/auth-service` → `auth-service`)
2. Convert all characters to lowercase
3. Replace underscores and spaces with hyphens
4. Remove any remaining characters that are not alphanumeric or hyphens

**Examples:**

| Raw manifest name        | Normalized service name |
|--------------------------|------------------------|
| `AuthService`            | `auth-service`         |
| `user_api`               | `user-api`             |
| `@acme/payment-gateway`  | `payment-gateway`      |
| `My Backend Service`     | `my-backend-service`   |

### 3. DISALLOWED generic names

The following names are **DISALLOWED** because they cause false identity merges when the same name appears in multiple repos:

```
server, worker, api, app, main, service, backend, frontend
```

If the manifest `name` field is one of these generic names, you **must** append a disambiguating suffix derived from the directory path or module path.

**Examples of disambiguation:**
- Manifest says `"api"`, service lives in `auth/` → use `auth-api`
- Manifest says `"worker"`, module path is `github.com/acme/billing/worker` → use `billing-worker`
- Manifest says `"app"`, service lives in `payments/` → use `payments-app`

### 4. Stability requirement

The service name in JSON output **must be stable across scans**. Always use the manifest name, never a runtime hostname, container tag, or environment-specific label.

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
      "name": "string — service identifier, MUST be lowercase-hyphenated, derived from package manifest name field (package.json 'name', pyproject.toml [project] name, go.mod module last segment, Cargo.toml [package] name). See Service Naming Convention section.",
      "root_path": "string — relative path to service root within repo",
      "language": "string — primary language (typescript, python, go, rust, java, etc.)",
      "type": "service | library | sdk | infra — 'service' for deployable units, 'library'/'sdk' for shared code, 'infra' for IaC repos",
      "boundary_entry": "string | null — file that external callers hit (e.g. 'src/main.py', 'src/routes/index.ts', 'src/index.ts' for libs)",
      "exposes": [
        "string — format depends on type (see Exposes Format Rules below)"
      ],
      "confidence": "high | low"
    }
  ],
  "connections": [
    {
      "source": "string — name of the calling service or library",
      "target": "string — name of the called service or library",
      "protocol": "rest | grpc | kafka | rabbitmq | internal | sdk | k8s | tf | helm",
      "crossing": "external | sdk | internal — 'external' for network calls, 'sdk' for library imports, 'internal' for same-service module calls",
      "method": "string — HTTP method (GET/POST/etc), 'produce', 'consume', 'import', 'call', 'deploy', or 'configure'",
      "path": "string — format depends on protocol (see Connection Path Rules below)",
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

**Exposes Format Rules (type-conditional):**

The `exposes` array format depends on the service `type`:

| Type | Format | Examples |
|------|--------|---------|
| `service` | `"METHOD /path"` for REST, `"topic-name"` for events | `"GET /users"`, `"POST /auth/token"`, `"order.created"` |
| `library` or `sdk` | `"functionName(param: Type): ReturnType"` — exported function signatures | `"createClient(config: Config): Client"`, `"parseEvent(raw: Buffer): Event"` |
| `infra` | `"prefix:resource-type/name"` or `"prefix:resource-type/name → target"` | See infra examples below |

For **services**: list every HTTP endpoint, gRPC method, or event topic the service handles. This is used to detect API mismatches.

For **libraries/SDKs**: list the **public exported functions** that other services import and call. Include parameter types and return types when visible from the source. At minimum, list `"functionName"`. This is used to determine whether a lib change affects a specific caller.

For **infra**: list the Kubernetes resources, Terraform outputs, or other infrastructure objects this repo manages. Use these prefixes:

| Prefix | Meaning | Examples |
|--------|---------|---------|
| `k8s:` | Kubernetes resource | `"k8s:deployment/payment-service"`, `"k8s:ingress/payment → payment.example.com"`, `"k8s:configmap/payment-env"` |
| `tf:` | Terraform resource/output | `"tf:resource/aws_rds_instance.payments"`, `"tf:output/db_connection_string"` |
| `helm:` | Helm chart release | `"helm:release/payment-service"`, `"helm:values/payment-service"` |
| `compose:` | Docker Compose service | `"compose:service/payment-db"` |

**Connection Path Rules (protocol-conditional):**

The `path` field format depends on the connection type:

| Protocol | Path format | Examples |
|----------|-------------|---------|
| `rest` | Template endpoint path | `"/users/{id}"`, `"/auth/validate"` |
| `grpc` | Service/method | `"UserService/GetUser"` |
| `kafka`, `rabbitmq` | Topic name | `"order.created"` |
| `sdk` | **Specific function name(s) called** — NOT the module path | `"createClient"`, `"parseEvent,sendCommand"` |
| `internal` | Module path or function | `"utils/auth:validateToken"` |
| `k8s` | `"k8s:resource-type/name → key"` — the specific resource and key that wires infra to service | `"k8s:configmap/payment-env → PAYMENT_DB_URL"`, `"k8s:secret/payment-creds → DB_PASSWORD"` |
| `tf` | `"tf:output/name"` or `"tf:resource/type.name"` | `"tf:output/db_connection_string"` |
| `helm` | `"helm:values/key-path"` | `"helm:values/image.tag"`, `"helm:values/env.DATABASE_URL"` |

For `sdk` connections: the `path` must be the **specific exported function(s)** the caller uses, not just the import path. This enables precise impact analysis — "lib X changed function Y; service A calls Y but service B only calls Z."

For `k8s`/`tf`/`helm` connections: these represent infra-to-service wiring. The `source` is the infra repo, the `target` is the service being deployed/configured. The `path` identifies **what specific configuration** connects them — which configmap key, which secret, which Helm value. This enables: "you changed values.yaml for payment-service, here are the 3 services whose env vars are affected."

**General notes:**

- `connections` is required (may be an empty array if no connections found)
- `schemas` is required (may be an empty array)
- `services` is required (must include at least the primary service)
- `target_file` is optional — set to `null` if the target handler file is not visible in this repo
- `fields[].required` must be a boolean (`true` or `false`), not a string

---

## Example Output

### Example 1: A service that calls another service and uses a shared library

```json
{
  "service_name": "user-api",
  "confidence": "high",
  "services": [
    {
      "name": "user-api",
      "root_path": "src/",
      "language": "typescript",
      "type": "service",
      "boundary_entry": "src/index.ts",
      "exposes": [
        "GET /users",
        "GET /users/{id}",
        "POST /users",
        "PUT /users/{id}",
        "DELETE /users/{id}"
      ],
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
      "target": "shared-sdk",
      "protocol": "sdk",
      "crossing": "sdk",
      "method": "import",
      "path": "createEventClient,publishEvent",
      "source_file": "src/handlers/user.ts:createUser",
      "target_file": null,
      "confidence": "high",
      "evidence": "import { createEventClient, publishEvent } from '@acme/shared-sdk'"
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

### Example 2: A shared library (scanned from its own repo)

```json
{
  "service_name": "shared-sdk",
  "confidence": "high",
  "services": [
    {
      "name": "shared-sdk",
      "root_path": ".",
      "language": "typescript",
      "type": "library",
      "boundary_entry": "src/index.ts",
      "exposes": [
        "createEventClient(config: EventConfig): EventClient",
        "publishEvent(client: EventClient, topic: string, payload: object): Promise<void>",
        "parseEvent(raw: Buffer): ParsedEvent",
        "EventConfig",
        "EventClient"
      ],
      "confidence": "high"
    }
  ],
  "connections": [],
  "schemas": []
}
```

### Example 3: An infrastructure repo (Kubernetes + Helm)

```json
{
  "service_name": "infra-core",
  "confidence": "high",
  "services": [
    {
      "name": "infra-core",
      "root_path": ".",
      "language": "yaml",
      "type": "infra",
      "boundary_entry": "kustomization.yaml",
      "exposes": [
        "k8s:deployment/payment-service",
        "k8s:deployment/auth-service",
        "k8s:configmap/payment-env",
        "k8s:secret/payment-creds",
        "k8s:ingress/payment → payment.example.com",
        "helm:release/monitoring-stack"
      ],
      "confidence": "high"
    }
  ],
  "connections": [
    {
      "source": "infra-core",
      "target": "payment-service",
      "protocol": "k8s",
      "crossing": "external",
      "method": "configure",
      "path": "k8s:configmap/payment-env → PAYMENT_DB_URL",
      "source_file": "overlays/prod/payment/configmap.yaml",
      "target_file": null,
      "confidence": "high",
      "evidence": "env:\n  - name: PAYMENT_DB_URL\n    valueFrom:\n      configMapKeyRef:\n        name: payment-env\n        key: PAYMENT_DB_URL"
    },
    {
      "source": "infra-core",
      "target": "payment-service",
      "protocol": "k8s",
      "crossing": "external",
      "method": "deploy",
      "path": "k8s:deployment/payment-service",
      "source_file": "overlays/prod/payment/deployment.yaml",
      "target_file": null,
      "confidence": "high",
      "evidence": "image: registry.example.com/payment-service:v1.2.3"
    },
    {
      "source": "infra-core",
      "target": "auth-service",
      "protocol": "k8s",
      "crossing": "external",
      "method": "configure",
      "path": "k8s:secret/auth-creds → AUTH_JWT_SECRET",
      "source_file": "overlays/prod/auth/secret.yaml",
      "target_file": null,
      "confidence": "high",
      "evidence": "stringData:\n  AUTH_JWT_SECRET: <sealed>"
    }
  ],
  "schemas": []
}
```

---

Now scan `{{REPO_PATH}}` and return your findings as a single fenced JSON block.
