# Phase 7: Quality Gate Skill - Research

**Researched:** 2026-03-15
**Domain:** Claude Code SKILL.md authoring — LLM prompt playbook with shell injection, subcommand dispatch, and Makefile preference
**Confidence:** HIGH — sourced from official installed plugin inspection, live SKILL.md examples, and architecture/stack research already verified

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GATE-01 | `/allclear` runs all quality checks (lint, format, test, typecheck) for detected project type | Detection via `!` shell injection; per-language tool tables below |
| GATE-02 | Subcommands: lint, format, test, typecheck, quick (lint+format only), fix (auto-fix lint+format) | `$ARGUMENTS` dispatch pattern; single SKILL.md handles all subcommands |
| GATE-03 | Prefer Makefile targets when Makefile exists | `make -n <target>` dry-run probe pattern; fallback table documented |
| GATE-04 | Report results with pass/fail status, timing, and command used per check | Bash `time` builtin output format; structured report template |
| GATE-05 | Auto-fix for lint/format only — never auto-fix test or typecheck | Explicit prohibition in SKILL.md; `fix` subcommand scope table |
</phase_requirements>

---

## Summary

Phase 7 produces a single file: `skills/quality-gate/SKILL.md`. This file is an LLM prompt playbook — not a shell script. It instructs Claude what commands to run when `/allclear` (or a subcommand) is invoked. The skill uses `!`command`` shell injection to detect the project type and Makefile targets at invocation time, then Claude executes the appropriate quality checks via the Bash tool and reports structured results.

The core design challenge is subcommand dispatch: `$ARGUMENTS` captures everything the user typed after `/allclear`. A simple `case`-style section in the SKILL.md body routes `$ARGUMENTS` to the right check subset. When `$ARGUMENTS` is empty, all checks run. The Makefile preference is implemented by probing with `make -n <target>` (dry run, no side effects) before falling back to direct tool invocation.

The skill does NOT need `disable-model-invocation: true` — users invoke it explicitly with `/allclear`, and Claude may reasonably auto-invoke it when context makes it appropriate (e.g., after completing a large change). The `allowed-tools` field must include `Bash` since all quality checks are Bash tool invocations.

**Primary recommendation:** Write one SKILL.md at `skills/quality-gate/SKILL.md` with `$ARGUMENTS`-based dispatch, `!`...`` project detection injection, a Makefile probe table, per-language fallback command table, and an explicit result report format. Keep the fix subcommand strictly scoped to lint+format only — state this prohibition explicitly in the SKILL.md.

---

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `skills/quality-gate/SKILL.md` | SKILL.md format (current) | The slash-command playbook | Official Claude Code plugin skill format; single file = single deliverable for this phase |
| `$ARGUMENTS` variable | built-in | Receives subcommand (lint, format, test, typecheck, quick, fix) | Built-in to Claude Code skill system; all text after the slash-command becomes `$ARGUMENTS` |
| `!`command`` shell injection | built-in | Live project detection, Makefile probe | Executes before Claude sees the prompt; injects real data into context |
| `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` | from Phase 2 | Detect project type | Shared library; skill references it via `!`source ${CLAUDE_PLUGIN_ROOT}/lib/detect.sh && detect_project_type .`` |
| Bash tool | Claude Code built-in | Run lint, format, test, typecheck commands | Required; all quality tool execution happens via Claude's Bash tool |

### Supporting

| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `make -n <target>` | GNU make | Probe if Makefile target exists without running it | Always check before falling back to direct tool invocation (GATE-03) |
| `time` bash builtin | bash | Capture per-check timing | Wrap each check invocation with `{ time <cmd>; } 2>&1` to capture wall time |
| `$ARGUMENTS` empty-check | bash if/case | Default behavior (all checks) | When user types `/allclear` with no args, `$ARGUMENTS` is empty string |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single SKILL.md with dispatch | One SKILL.md per subcommand | Multiple files is cleaner isolation but adds complexity; single file is idiomatic for a skill family with shared detection logic |
| `!`...`` for project detection | Hardcoded project type | Shell injection gives live context; hardcoding would silently wrong if project type changes |
| `make -n` probe | Check if Makefile exists + grep targets | `make -n` is authoritative; grep might miss conditional target definitions |

---

## Architecture Patterns

### Recommended File Layout

```
skills/quality-gate/
└── SKILL.md              # The entire phase 7 deliverable
```

No supporting scripts are needed for this phase — all detection logic lives in `lib/detect.sh` (Phase 2), and all tool execution happens via Claude's Bash tool invocations guided by the SKILL.md prompt.

### Pattern 1: SKILL.md Frontmatter

**What:** The YAML frontmatter controls how Claude Code loads and invokes the skill. The `name` field sets the slash-command namespace. `allowed-tools: Bash` is required for quality check execution.

**Example:**
```yaml
---
name: quality-gate
description: Run quality checks for this project. Use when the user invokes /allclear, asks to verify code before commit, or wants to run the full quality suite.
allowed-tools: Bash
argument-hint: "[lint|format|test|typecheck|quick|fix]"
---
```

**Notes on frontmatter fields (HIGH confidence — from live plugin inspection):**
- `name`: Sets the skill identifier. In a plugin context, invocation is `/allclear` if the plugin name is `allclear` and skill name matches, or `/allclear:quality-gate` — needs runtime verification (see Open Questions).
- `description`: Used by Claude to decide when to auto-invoke. Must describe both user invocation triggers and autonomous-invocation conditions.
- `allowed-tools: Bash`: Restricts Claude to only run Bash tool during skill execution. Correct for a quality gate that only needs to execute shell commands.
- `argument-hint`: Displayed in `/help` as a hint. Square brackets indicate optional argument.
- `disable-model-invocation`: Omit (default allows both user and Claude to invoke). For `/allclear`, user invocation is primary but Claude auto-invocation is acceptable and useful.

### Pattern 2: Shell Injection for Live Project Detection

**What:** `!`command`` in the SKILL.md body executes at load time and injects the output into the prompt before Claude sees it. Use this to inject detected project type and Makefile target availability.

**Example:**
```markdown
## Project Context

- **Project type:** !`source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" && detect_project_type .`
- **Makefile targets:** !`[ -f Makefile ] && make -qp 2>/dev/null | grep -E '^(lint|format|test|typecheck|check|fmt|build):' | cut -d: -f1 | tr '\n' ' ' || echo "none"`
- **Working directory:** !`pwd`
```

**Why this works:** Claude receives the prompt with actual values substituted — e.g., "Project type: python" — and uses that data to select the right commands below. The detection logic is not duplicated in SKILL.md; it delegates to `lib/detect.sh`.

**Path concern (from STATE.md blockers):** `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` is the more reliable path than the relative `${CLAUDE_SKILL_DIR}/../../lib/detect.sh`. Use `${CLAUDE_PLUGIN_ROOT}` — verified as the correct variable name from live plugin inspection.

### Pattern 3: $ARGUMENTS Dispatch

**What:** `$ARGUMENTS` contains everything typed after the slash-command. An empty `$ARGUMENTS` means "run everything." Named subcommands route to targeted check subsets.

**Example structure for the SKILL.md body:**

```markdown
## Subcommand: $ARGUMENTS

Run the appropriate quality checks based on the subcommand above:

| $ARGUMENTS value | Checks to run |
|-----------------|---------------|
| (empty)         | lint, format check, test, typecheck |
| lint            | lint only |
| format          | format check only (dry-run, no fix) |
| test            | tests only |
| typecheck       | type checking only |
| quick           | lint + format check (no tests, no typecheck) |
| fix             | lint --fix + format --write (auto-applies changes) |

If $ARGUMENTS does not match any value above, treat as empty (run all checks).
```

**Critical constraint for `fix`:** The SKILL.md must explicitly state: "The `fix` subcommand ONLY applies auto-fixes to lint and format. Never auto-fix test failures or typecheck errors — those require human review."

### Pattern 4: Makefile Preference with Fallback Table

**What:** GATE-03 requires preferring `make lint`, `make format`, etc. over direct tool invocation when the Makefile has matching targets. The `!` injection above captures which targets exist. The SKILL.md then tells Claude to check for each target before falling back.

**Example decision table in SKILL.md:**

```markdown
## Command Selection

For each check, use the Makefile target if it was listed in the Makefile targets above. Otherwise use the direct command from the fallback table below.

### Lint
- Makefile: `make lint` (if "lint" was in Makefile targets)
- Python fallback: `ruff check .`
- Rust fallback: `cargo clippy -- -D warnings`
- TypeScript/JavaScript fallback: `npx eslint .`
- Go fallback: `golangci-lint run`

### Format (check only, no fix)
- Makefile: `make format` or `make fmt` (if listed)
- Python fallback: `ruff format --check .`
- Rust fallback: `cargo fmt --check`
- TypeScript/JavaScript fallback: `npx prettier --check .`
- Go fallback: `gofmt -l . | grep . && exit 1 || exit 0`

### Test
- Makefile: `make test` (if listed)
- Python fallback: `pytest` (or `python -m pytest`)
- Rust fallback: `cargo test`
- TypeScript/JavaScript fallback: detect from package.json scripts: `npm test` or `npx vitest run` or `npx jest`
- Go fallback: `go test ./...`

### Typecheck
- Makefile: `make typecheck` or `make check` (if listed)
- Python fallback: `mypy .` (if mypy configured) or `pyright` (if pyrightconfig.json exists)
- Rust fallback: `cargo check`
- TypeScript fallback: `npx tsc --noEmit`
- Go fallback: `go vet ./...`
```

### Pattern 5: Result Report Format

**What:** GATE-04 requires reporting pass/fail status, timing, and the exact command used for each check. A consistent format lets users scan results quickly.

**Required output format to specify in SKILL.md:**

```markdown
## Reporting

After running all requested checks, report results in this format:

```
## AllClear Quality Gate Results

| Check      | Status | Time   | Command                    |
|------------|--------|--------|----------------------------|
| lint       | PASS   | 1.2s   | make lint                  |
| format     | FAIL   | 0.4s   | ruff format --check .      |
| test       | PASS   | 8.3s   | cargo test                 |
| typecheck  | PASS   | 2.1s   | npx tsc --noEmit           |

**1 check failed. Run `/allclear fix` to auto-fix lint and format issues.**
```

Measure timing with `{ time <command>; } 2>&1` and extract the real time from output.
```

**For the `fix` subcommand, add after applying fixes:**

```
## AllClear Fix Results

Applied auto-fixes:
- lint: ruff check --fix . (12 issues fixed)
- format: ruff format . (3 files reformatted)

Re-run `/allclear` to verify fixes resolved all issues.
Note: Test and typecheck failures require manual intervention.
```

### Anti-Patterns to Avoid

- **Putting detection logic inline in SKILL.md:** Detection code belongs in `lib/detect.sh`. If the skill duplicates it, detection logic drifts between Phase 2 library and Phase 7 skill. Use `!`source ... && detect_project_type .`` instead.
- **Using relative paths to lib/:** `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` is fragile when plugin is cache-copied. Always use `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh`.
- **Blocking on no tools found:** If none of the language tools are installed, the skill should report "no quality tools detected" and exit cleanly — not error or hang.
- **Running `make format` in the default (all-checks) run without `--check`:** The default run should be read-only (check only). Auto-applying format changes without explicit `fix` subcommand violates GATE-05's principle that auto-fix is opt-in.
- **Omitting the `fix` scope prohibition:** GATE-05 is a hard constraint. The SKILL.md must explicitly state that `fix` never touches tests or typecheck. Without this explicit instruction, Claude may try to be helpful and attempt auto-fixes beyond the allowed scope.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project type detection | Custom file-probe logic in SKILL.md | `lib/detect.sh` from Phase 2 | Already built; SKILL.md duplicating it causes drift |
| Makefile target enumeration | Custom grep/awk parsing | `make -n <target>` dry-run + `make -qp` | Make's own machinery is authoritative; custom grep misses conditional targets |
| Test runner detection for Node.js | Custom logic | Check `package.json` scripts.test field via Bash | npm test already dispatches to jest/vitest/mocha per project config |
| Per-language tool availability check | Custom which-loop | `command -v <tool> >/dev/null 2>&1` | Standard POSIX idiom; handles PATH correctly |

**Key insight:** The SKILL.md is instruction, not code. The "don't hand-roll" principle here means don't write detection logic into the SKILL.md prose when a shell library already does it. Keep SKILL.md as decision tables and prompt structure; keep code in lib/.

---

## Common Pitfalls

### Pitfall 1: Skill Namespace / Invocation Path

**What goes wrong:** The skill may be invoked as `/allclear` or `/allclear:quality-gate` depending on how the plugin registers the namespace, and which Claude Code version is installed.

**Why it happens:** Plugin skill namespacing behavior was still being clarified in March 2026 (STATE.md blocker: "Skill namespace in /help... needs verification in a dev session with --plugin-dir before finalizing SKILL.md frontmatter").

**How to avoid:** The `name` field in the frontmatter should be set to match the intended invocation. The architecture research shows the pattern `name: quality-gate` under a plugin named `allclear`. The invocation form should be verified with `claude --plugin-dir ./` in a dev session before declaring it done. Document both forms in the SKILL.md description.

**Warning signs:** `/allclear` reports "command not found" but `/allclear:quality-gate` works, or vice versa.

### Pitfall 2: $ARGUMENTS Is Empty String, Not Unset

**What goes wrong:** Writing `if [ -z "$ARGUMENTS" ]` in a shell injection vs. checking the literal string `$ARGUMENTS` in the SKILL.md body. The `$ARGUMENTS` variable is a Claude Code template substitution — it appears as literal text in SKILL.md, not as a runtime shell variable.

**Why it happens:** SKILL.md is an LLM prompt, not a shell script. `$ARGUMENTS` is replaced by Claude Code before the prompt is loaded. The resulting prompt will contain the actual argument value (or empty string). Claude then reads the prompt and uses it as instruction.

**How to avoid:** In the SKILL.md, write the dispatch table as natural language instructions (shown in Pattern 3 above). The if/case logic is Claude's interpretation of the table, not a shell expression.

### Pitfall 3: `make -n` Can Have Side Effects on Some Projects

**What goes wrong:** `make -n` is supposed to be a dry run but some Makefiles have targets with side effects even on `-n` (e.g., targets that call sub-makes or eval). Using `make -qp` (print database) is safer for enumerating targets.

**Why it happens:** The `-n` flag suppresses recipe execution but not all Makefile mechanics. `make -qp` dumps the parsed rule database without executing any recipe at all.

**How to avoid:** Use `make -qp 2>/dev/null | grep -E '^[a-zA-Z_-]+:' | cut -d: -f1` for the `!` injection to list targets, then use `make <target>` (with actual execution) only when running checks. The dry-run probe isn't needed for invocation — knowing the target exists from `-qp` is sufficient.

### Pitfall 4: Format Check vs. Format Apply Confusion

**What goes wrong:** The default run (no subcommand) accidentally modifies files because the format command applied changes instead of checking them.

**Why it happens:** Many formatters (ruff, prettier, gofmt) apply changes by default. The check-only mode requires an explicit flag: `ruff format --check`, `prettier --check`, `cargo fmt --check`, `gofmt -l`.

**How to avoid:** The SKILL.md command tables (Pattern 4) must consistently use check-only invocations for the default and `format` subcommands. Only the `fix` subcommand uses the write/apply form.

### Pitfall 5: Timing Capture Syntax

**What goes wrong:** `time command` in bash outputs timing to stderr, and the format varies between bash `time` builtin and `/usr/bin/time`. Wrapping incorrectly captures nothing.

**Why it happens:** `time` behavior differs across shells and systems. The bash builtin `{ time command; } 2>&1` captures both stdout and stderr including timing lines.

**How to avoid:** Instruct Claude in the SKILL.md to use `{ time <command>; } 2>&1` and parse the `real` line, or to use `date +%s%N` before/after for millisecond precision if the result format matters.

---

## Code Examples

Verified patterns from official sources and architecture research:

### SKILL.md Frontmatter (from live plugin inspection)

```yaml
---
name: quality-gate
description: Run quality checks for this project. Use when the user invokes /allclear, asks to verify code quality, or wants to confirm code is clean before committing.
allowed-tools: Bash
argument-hint: "[lint|format|test|typecheck|quick|fix]"
---
```

Source: Frontmatter fields verified from `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/references/skills-reference.md` and direct plugin inspection.

### Shell Injection for Project Detection

```markdown
## Project Context

- **Project type:** !`source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" && detect_project_type .`
- **Makefile targets available:** !`[ -f Makefile ] && make -qp 2>/dev/null | grep -E '^[a-zA-Z_-]+:[^=]' | grep -E '^(lint|format|fmt|test|typecheck|check|quick|fix):' | cut -d: -f1 | tr '\n' ' ' || echo "none"`
```

Source: `!`command`` injection pattern from ARCHITECTURE.md Pattern 3 + STATE.md blocker note on `${CLAUDE_PLUGIN_ROOT}` reliability.

### $ARGUMENTS Variable Usage

```markdown
## Arguments

Subcommand: $ARGUMENTS

(If empty, run all checks: lint, format-check, test, typecheck)
```

Source: `$ARGUMENTS` pattern from skills-reference.md: "All args as string — `/deploy staging` → 'staging'".

### Timing Capture Instruction

```markdown
For each check, capture timing:
```bash
START=$(date +%s)
<command>
STATUS=$?
END=$(date +%s)
ELAPSED=$((END - START))
```
Report status as PASS if exit code is 0, FAIL otherwise. Report elapsed as "${ELAPSED}s".
```

### Makefile Probe Pattern

```markdown
Before running each check, verify the Makefile target is available from the injected list above.
- If "lint" appears in the Makefile targets: run `make lint`
- Otherwise: run the direct fallback command for the detected project type
```

Source: Makefile preference pattern from GATE-03 requirement + `make -qp` safety recommendation in Pitfall 3.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `commands/` .md files for slash commands | `skills/` SKILL.md files | Early 2025 | `skills/` supports both user invocation and Claude auto-invocation; `commands/` is legacy |
| Hardcoded tool invocations in skills | `!`command`` injection for live detection | Current | Skills receive real data at invocation time rather than stale hardcoded logic |
| `$CLAUDE_SKILL_DIR/../../lib/` paths | `${CLAUDE_PLUGIN_ROOT}/lib/` paths | Current (per STATE.md) | Plugin root variable survives cache relocation; skill-dir relative paths are fragile |

**Deprecated/outdated:**
- `commands/` directory: Legacy format, does not support autonomous invocation. Do not use for new skills.
- Hardcoded language detection inside SKILL.md: Delegate to `lib/detect.sh` instead.

---

## Open Questions

1. **Invocation namespace: `/allclear` vs `/allclear:quality-gate`**
   - What we know: Plugin name is `allclear`; skill name in frontmatter is `quality-gate`; STATE.md explicitly flags this as needing runtime verification
   - What's unclear: Whether the skill is invocable as just `/allclear` (plugin name alone, if quality-gate is the default skill) or requires the full `/allclear:quality-gate` form
   - Recommendation: Set `name: quality-gate` in frontmatter; document both invocation forms in the `description` field; verify with `claude --plugin-dir ./ ` in a dev session as a Wave 0 task in the PLAN

2. **`lib/detect.sh` availability at Phase 7 execution time**
   - What we know: Phase 7 is independent of Phase 2 at authoring time; the skill references `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` which is written in Phase 2
   - What's unclear: If Phase 7 is executed before Phase 2, the shell injection will fail with a file-not-found error
   - Recommendation: The SKILL.md should gracefully handle a missing `lib/detect.sh` by falling back to inline detection (check for pyproject.toml, Cargo.toml, package.json, go.mod directly). Document this as a graceful degradation.

3. **`$ARGUMENTS` injection behavior for multi-word subcommands**
   - What we know: `$ARGUMENTS` captures all text after the slash-command as a single string
   - What's unclear: Whether `/allclear fix lint` results in `$ARGUMENTS = "fix lint"` or just `"fix"` — subcommand chaining isn't defined in official docs
   - Recommendation: Design SKILL.md to handle the simple single-word subcommand cases only; document that `/allclear fix` applies to both lint and format, no further qualification needed

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core 1.13.0 (Phase 13) |
| Config file | `tests/` flat directory (per architecture research) |
| Quick run command | `./test/bats/bin/bats tests/quality-gate.bats` |
| Full suite command | `./test/bats/bin/bats tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | `/allclear` runs all checks | manual-only | n/a — SKILL.md is an LLM prompt; behavior verified via interactive session | ❌ Wave 0 gap — no bats test for SKILL.md content |
| GATE-02 | Subcommands dispatch correctly | manual-only | n/a — subcommand dispatch is LLM instruction, not shell logic | ❌ Wave 0 gap |
| GATE-03 | Makefile target preference | manual-only | n/a — decision logic is in LLM prompt | ❌ Wave 0 gap |
| GATE-04 | Results report format | manual-only | n/a | ❌ Wave 0 gap |
| GATE-05 | fix scope restricted to lint+format | manual-only | n/a | ❌ Wave 0 gap |

### Sampling Rate

- **Per task commit:** Review SKILL.md content against this research document
- **Per wave merge:** Load skill in dev session with `claude --plugin-dir ./` and invoke each subcommand
- **Phase gate:** Interactive verification of all 6 subcommands (empty, lint, format, test, typecheck, quick, fix) against a Python and TypeScript project before marking phase complete

### Wave 0 Gaps

Note: SKILL.md is an LLM prompt playbook, not executable shell code. Bats tests cannot unit-test LLM prompt content. Validation is interactive (dev session with `--plugin-dir`) rather than automated.

- [ ] `tests/quality-gate.bats` — Placeholder: if shell helper scripts are added alongside SKILL.md (e.g., a timing wrapper script), those can be tested. Currently no shell code to test in this phase.
- [ ] Dev session smoke test checklist (manual): invoke `/allclear`, `/allclear lint`, `/allclear format`, `/allclear test`, `/allclear typecheck`, `/allclear quick`, `/allclear fix` against a test repo with Python + TypeScript files and a Makefile

---

## Sources

### Primary (HIGH confidence)

- `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/skills/do/SKILL.md` — Live SKILL.md frontmatter format, body structure, dispatch patterns
- `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/references/skills-reference.md` — Frontmatter field reference (`disable-model-invocation`, `user-invocable`, `allowed-tools`, `context`, `$ARGUMENTS` behavior, `!`command`` injection)
- `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/SKILL.md` — Example of complex skill with multi-phase workflow and tool restriction (`tools:` field)
- `.planning/research/ARCHITECTURE.md` — Pattern 3 (Skills as Orchestration Prompts), `${CLAUDE_PLUGIN_ROOT}` vs `${CLAUDE_SKILL_DIR}` path reliability, `!`command`` injection data flow
- `.planning/research/STACK.md` — `${CLAUDE_PLUGIN_ROOT}` variable, `argument-hint` field, SKILL.md frontmatter fields, version compatibility

### Secondary (MEDIUM confidence)

- `.planning/research/FEATURES.md` — Feature dependencies, anti-feature analysis for auto-fix scope, zero-config requirement
- `.planning/REQUIREMENTS.md` — GATE-01 through GATE-05 verbatim requirements
- `.planning/ROADMAP.md` — Phase 7 success criteria (authoritative for what "done" means)
- `.planning/STATE.md` — Blockers section: skill namespace verification needed, `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` path reliability concern

### Tertiary (LOW confidence — needs runtime verification)

- Skill invocation namespace behavior (`/allclear` vs `/allclear:quality-gate`) — not definitively documented; needs `--plugin-dir` test session

---

## Metadata

**Confidence breakdown:**
- SKILL.md format and frontmatter fields: HIGH — verified from live installed plugins and official references
- Shell injection pattern and `$ARGUMENTS` behavior: HIGH — multiple verified examples in official plugin cache
- Makefile probe approach (`make -qp`): MEDIUM — standard make behavior, not Claude Code-specific; verified idiom
- Skill invocation namespace: LOW — explicitly flagged as unverified in STATE.md; needs dev session confirmation
- Per-language tool command table: HIGH — standard tool flags verified from tool documentation and architecture research

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (SKILL.md format is stable; Claude Code plugin API evolves slowly)
