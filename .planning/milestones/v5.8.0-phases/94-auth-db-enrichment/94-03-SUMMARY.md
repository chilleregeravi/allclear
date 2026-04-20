---
phase: 94-auth-db-enrichment
plan: "03"
subsystem: worker/scan/enrichment
tags: [ruby, rails, devise, activerecord, auth-enrichment, db-enrichment, tdd]
dependency_graph:
  requires: [java-auth-db-enrichment, csharp-auth-db-enrichment]
  provides: [ruby-auth-db-enrichment]
  affects: [auth-db-extractor.js, enrichment-pipeline]
tech_stack:
  added: []
  patterns: [signal-table-per-language, tdd-red-green, yml-adapter-probe]
key_files:
  created:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.ruby.test.js
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/Gemfile
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/config/database.yml
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/config/routes.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/app/controllers/application_controller.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/app/controllers/users_controller.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby/app/models/user.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-httpbasic/app/controllers/application_controller.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-httpbasic/config/database.yml
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-mysql/config/database.yml
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-mysql/app/controllers/application_controller.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-yml-authoritative/config/database.yml
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-yml-authoritative/Gemfile
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-yml-authoritative/app/models/user.rb
    - plugins/arcanon/worker/scan/enrichment/fixtures/ruby-empty/app/some.rb
  modified:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js
decisions:
  - "config/database.yml adapter: probe runs on ALL files in the envFiles loop (not gated on filename) — the regex won't match .env dotfiles so it is safe and eliminates a conditional branch"
  - "http-basic used as mechanism label (not session) for authenticate_or_request_with_http_basic — distinct from Devise session and safe for isCredential() check (10 chars, low entropy)"
  - "yml-authoritative ordering enforced by detectDbFromEnv() running before detectDbFromSources() in the prisma > env > source dispatch chain (no code change needed — ordering was already correct)"
metrics:
  duration: "~180s"
  completed: "2026-04-19"
  tasks_completed: 2
  files_changed: 16
---

# Phase 94 Plan 03: Ruby Auth/DB Enrichment Summary

Ruby auth/db signal tables and Rails config/database.yml adapter probe added to auth-db-extractor.js, closing the Rails DB detection gap where adapter is statically configured in yml rather than DATABASE_URL.

## What Was Done

Extended `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` with four edits:

1. **AUTH_SIGNALS.ruby** — 6 entries covering:
   - `session`: Devise (`devise`, `devise_for`, `before_action :authenticate_user!`, Devise internal controllers) and Warden directly (ENR-04)
   - `http-basic`: `authenticate_or_request_with_http_basic`, `authenticate_with_http_basic`, `ActionController::HttpAuthentication::Basic` (ENR-04 explicit requirement)
   - `jwt`: `require 'jwt'`, `JWT.decode/encode`, `JsonWebToken`, Knock pattern
   - `oauth2`: OmniAuth builder, provider declarations (google/github/facebook)
   - `api-key`: `authenticate_api_key`, `ApiKey.find_by`, `X-Api-Key`

2. **DB_SOURCE_SIGNALS.ruby** — 5 entries covering `postgresql` (pg gem, PG::Connection), `mysql` (mysql2, Mysql2::Client), `sqlite` (sqlite3, SQLite3::Database), `mongodb` (mongoid, Mongoid::Document), `redis` (Redis.new, Sidekiq) — fallbacks when config/database.yml is absent (ENR-07)

3. **LANG_EXTENSIONS.ruby** — `['.rb']` so `.rb` files are collected during traversal (ENR-01 ruby portion)

4. **detectDbFromEnv()** — `config/database.yml` appended to `envFiles` list; new `adapter:` regex probe added after the `DATABASE_URL` match block. Normalizes `postgresql`/`postgis` → `postgresql`, `mysql*` → `mysql`, `sqlite*` → `sqlite`. Safe on all env files — won't match `.env` dotfile content. (ENR-07 locked decision)

Fixture tree created under:
- `fixtures/ruby/` — Rails 7 app with Devise (`before_action :authenticate_user!`, `devise_for :users`) + `config/database.yml` (`adapter: postgresql`) + `pg` gem
- `fixtures/ruby-httpbasic/` — `authenticate_or_request_with_http_basic` controller + `config/database.yml` (`adapter: mysql2`)
- `fixtures/ruby-mysql/` — Devise controller + `config/database.yml` (`adapter: mysql2`)
- `fixtures/ruby-yml-authoritative/` — `config/database.yml` (`adapter: sqlite3`) + `Gemfile` with `gem 'pg'` + `ActiveRecord::Base` model — yml wins over source signal
- `fixtures/ruby-empty/` — bare Ruby class, no signals

End-to-end test `auth-db-extractor.ruby.test.js` — 5 tests, all GREEN:
- Test A: Devise fixture yields `auth_mechanism='session'`, `db_backend='postgresql'` (from yml, no DATABASE_URL)
- Test B: HTTP basic fixture yields `auth_mechanism` non-null (`http-basic`), `db_backend='mysql'`
- Test C: mysql2 database.yml yields `db_backend='mysql'`
- Test D: sqlite3 yml with pg gem Gemfile yields `db_backend='sqlite'` (yml authoritative over source signals)
- Test E: Empty Ruby fixture yields both null

Regression tests — no failures:
- `auth-db-extractor.csharp.test.js` — 6/6 pass (Plan 94-02 unchanged)
- `auth-db-extractor.java.test.js` — 5/5 pass (Plan 94-01 unchanged)
- `auth-db-extractor.test.js` — 35/35 pass (python/js/ts/go/rust unchanged)

## Deviations from Plan

None — plan executed exactly as written.

The `adapter:` probe was implemented to run unconditionally in the envFiles loop (not gated on `envFile.endsWith('database.yml')`) as the plan's interface section noted this is safe — `.env` files don't contain `adapter:` keys. This matches the plan's suggested approach.

## TDD Gate Compliance

- RED commit: `d3b719d` — `test(94-03): add failing Ruby auth/db fixture + e2e test (ENR-09 ruby)`
- GREEN commit: `7d1f028` — `feat(94-03): add Ruby auth/db signals + config/database.yml adapter probe (ENR-01, ENR-04, ENR-07)`

Both gates present. No REFACTOR pass needed — implementation was clean on first pass.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. The `config/database.yml` probe is read-only file scanning, same pattern as existing `.env` probing.

## Self-Check: PASSED

Files verified present:
- `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` (modified — ruby entries + detectDbFromEnv extension)
- `auth-db-extractor.ruby.test.js` (created)
- `fixtures/ruby/config/database.yml`, `app/controllers/application_controller.rb`, `config/routes.rb`, `Gemfile`, `app/models/user.rb`
- `fixtures/ruby-httpbasic/app/controllers/application_controller.rb`, `config/database.yml`
- `fixtures/ruby-mysql/config/database.yml`, `app/controllers/application_controller.rb`
- `fixtures/ruby-yml-authoritative/config/database.yml`, `Gemfile`, `app/models/user.rb`
- `fixtures/ruby-empty/app/some.rb`

Commits verified: d3b719d (RED), 7d1f028 (GREEN)
