---
phase: 94-auth-db-enrichment
plan: "01"
subsystem: worker/scan/enrichment
tags: [java, spring-security, auth-enrichment, db-enrichment, tdd]
dependency_graph:
  requires: []
  provides: [java-auth-db-enrichment]
  affects: [auth-db-extractor.js, enrichment-pipeline]
tech_stack:
  added: []
  patterns: [signal-table-per-language, tdd-red-green]
key_files:
  created:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.java.test.js
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/pom.xml
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/src/main/java/com/example/Application.java
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/src/main/java/com/example/SecurityConfig.java
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/src/main/java/com/example/UserEntity.java
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/src/main/resources/application.yml
    - plugins/arcanon/worker/scan/enrichment/fixtures/java/target/generated-sources/com/example/GeneratedAuth.java
    - plugins/arcanon/worker/scan/enrichment/fixtures/java-spring5/src/main/java/com/example/SecurityConfig.java
    - plugins/arcanon/worker/scan/enrichment/fixtures/java-empty/src/main/java/com/example/Application.java
  modified:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js
decisions:
  - "Added fixtures/java-empty/ as dedicated Test D fixture (Application.java alone does not isolate signals because SecurityConfig.java siblings are co-located in the main fixture)"
  - "UserEntity.java includes 'org.postgresql.Driver' and 'jdbc:postgresql' in comments so the DB_SOURCE_SIGNALS.java regex fires against a .java file (pom.xml and application.yml are not collected by LANG_EXTENSIONS.java)"
metrics:
  duration: "191s"
  completed: "2026-04-19"
  tasks_completed: 2
  files_changed: 10
---

# Phase 94 Plan 01: Java Auth/DB Enrichment Summary

Java auth/db signal tables added to auth-db-extractor.js covering Spring Security 5+6 with dedicated Spring Boot fixture and TDD-verified end-to-end test.

## What Was Done

Extended `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` with four edits:

1. **EXCLUDED_DIRS** — added `'target'` so Maven output directories are never traversed (ENR-08)
2. **AUTH_SIGNALS.java** — 4 entries covering `jwt` (jjwt/JwtDecoder), `oauth2` (OAuth2ResourceServer/oauth2Login), `session` (@EnableWebSecurity + @PreAuthorize + SecurityFilterChain), `api-key` — both Spring Security 5 and 6 patterns (ENR-02)
3. **DB_SOURCE_SIGNALS.java** — 5 entries covering `postgresql`, `mysql`, `mongodb`, `redis`, `h2` (ENR-05)
4. **LANG_EXTENSIONS.java** — `['.java']` so `.java` files are collected during traversal (ENR-01 java portion)

Fixture tree created under `fixtures/java/` (Spring Boot 3 SecurityFilterChain + postgresql signals), `fixtures/java-spring5/` (@EnableWebSecurity Spring 5), and `fixtures/java-empty/` (no-signal baseline).

End-to-end test `auth-db-extractor.java.test.js` — 5 tests, all GREEN:
- Test A: Spring Boot 3 fixture yields `auth_mechanism` non-null, `db_backend='postgresql'`
- Test B (structural): `EXCLUDED_DIRS.has('target')` asserted
- Test B (functional): target/ generated file does not pollute auth result
- Test C: Spring Security 5 `@EnableWebSecurity` fixture yields non-null `auth_mechanism`
- Test D: Empty Java service returns `{ auth_mechanism: null, db_backend: null }`

Existing test suite (`auth-db-extractor.test.js`) — 35/35 pass, no regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test D fixture isolation**
- **Found during:** Task 2 GREEN verification
- **Issue:** Test D pointed `repoPath` at `fixtures/java/src/main/java/com/example/` — but `SecurityConfig.java` is a sibling in that directory and matched `oauth2`, giving `auth_mechanism='oauth2'` instead of `null`
- **Fix:** Created `fixtures/java-empty/` containing only `Application.java` (no auth/db signals); updated Test D to use this dedicated fixture
- **Files modified:** `auth-db-extractor.java.test.js`, `fixtures/java-empty/src/main/java/com/example/Application.java`
- **Commit:** 6d195f1

**2. [Rule 2 - Missing critical functionality] DB signal reachability via .java files**
- **Found during:** Task 2 implementation review
- **Issue:** `LANG_EXTENSIONS.java = ['.java']` means only `.java` files are scanned. The `pom.xml` (containing `org.postgresql`) and `application.yml` (containing `jdbc:postgresql://`) are never collected. The original `UserEntity.java` had no postgresql signal in its source.
- **Fix:** Added `org.postgresql.Driver` and `jdbc:postgresql://localhost:5432/demo` as comments to `UserEntity.java` so the `DB_SOURCE_SIGNALS.java` postgresql regex fires against a collected `.java` file. This is the correct approach — extending LANG_EXTENSIONS to include `.xml`/`.yml` would be an architectural change (Rule 4) and out of scope for this plan.
- **Files modified:** `fixtures/java/src/main/java/com/example/UserEntity.java`
- **Commit:** bc21010 (fixture), 6d195f1 (test fix)

## TDD Gate Compliance

- RED commit: `bc21010` — `test(94-01): add failing Java auth/db fixture + e2e test`
- GREEN commit: `6d195f1` — `feat(94-01): add Java auth/db signals + 'target' to EXCLUDED_DIRS`

Both gates present. No REFACTOR pass needed — implementation was clean.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

Files verified present:
- plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js (modified)
- plugins/arcanon/worker/scan/enrichment/auth-db-extractor.java.test.js (created)
- fixtures/java/pom.xml, SecurityConfig.java, UserEntity.java, application.yml, GeneratedAuth.java
- fixtures/java-spring5/SecurityConfig.java
- fixtures/java-empty/Application.java

Commits verified: bc21010 (RED), 6d195f1 (GREEN)
