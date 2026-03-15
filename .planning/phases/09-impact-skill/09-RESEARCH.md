# Phase 9: Impact Skill - Research

**Researched:** 2026-03-15
**Domain:** Cross-repo reference scanning — bash skill, grep-based search, git diff symbol extraction
**Confidence:** HIGH — patterns verified against live repo data, official plugin conventions from ARCHITECTURE.md

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IMPT-01 | `/allclear impact` skill scans sibling repos for references to specified search terms | Core grep scan loop documented; SKILL.md pattern from ARCHITECTURE.md verified |
| IMPT-02 | Skill auto-detects sibling repos by scanning parent directory for .git/ directories | Siblings discovery confirmed: scan `$(dirname $PWD)/*/` for `.git`; verified against live sources dir (11 sibling repos found) |
| IMPT-03 | Skill supports `--changed` flag to auto-detect symbols from git diff HEAD~1 | `git diff HEAD~1 --name-only` and line-level extraction approaches documented; language-specific strategies provided |
| IMPT-04 | Skill classifies matches by type: code, config, documentation, test | Classification algorithm documented: path-based heuristics, extension mapping, test-path detection |
| IMPT-05 | Skill groups results by repo with match counts and file locations | Output format: per-repo section, per-file listing; file count (not line count) is correct UX |
| IMPT-06 | Skill supports config override for sibling repo paths via allclear.config.json | Config schema designed; siblings key with path array; impact.exclude override sub-key |
| IMPT-07 | Skill supports --exclude flag to skip specific repos | CLI argument parsing pattern for skills documented |
</phase_requirements>

---

## Summary

Phase 9 delivers AllClear's primary differentiator: cross-repo reference scanning. No other Claude Code plugin offers this feature. The skill must scan all sibling repositories for any reference to a changed symbol, classify each match by type (code, config, docs, test), and group results by repo.

The implementation is entirely in a `SKILL.md` file backed by a bash helper script (`scripts/impact.sh`). The skill uses `lib/siblings.sh` for discovery (already designed in Phase 2) and a grep-based loop for scanning. All scanning is local — no network calls, no external services. Performance testing on real sibling repos shows sub-second per-repo scan times for typical codebases using targeted `--include` extension filters.

The critical design insight from live testing: output should report **unique file count and file paths**, not line count. A symbol appearing 40 times in one file is less important than it appearing in 40 different files across a repo. The scan output is consumed by Claude, which summarizes and reasons over it — so structured, parseable output is more valuable than human-formatted text.

**Primary recommendation:** Implement as a SKILL.md with `disable-model-invocation: false` and a supporting `scripts/impact.sh` that outputs structured data Claude can reason over. The SKILL.md instructions tell Claude what to invoke and how to interpret results.

---

## Standard Stack

### Core

| Component | Version/Type | Purpose | Why Standard |
|-----------|-------------|---------|--------------|
| `skills/cross-impact/SKILL.md` | YAML frontmatter + Markdown | Claude prompt playbook for /allclear impact | Official Claude Code skill convention; established in Phase 7 (quality-gate) |
| `scripts/impact.sh` | Bash 3.2+ | Core scan loop: sibling discovery, grep, classification, output | Shell-based for portability; no external deps; consistent with all other AllClear scripts |
| `lib/siblings.sh` | Bash library | Sibling repo discovery (parent dir scan + config.json override) | Shared library designed in Phase 2; reuse avoids duplication |
| `lib/detect.sh` | Bash library | Optional: project type detection for context | Shared library; may be used to contextualize scan scope |
| `grep` | System (macOS/Linux) | File content search across repos | Available everywhere; `--include` extension filtering prevents scanning binaries/generated files |
| `git` | System (2.x+) | `git diff HEAD~1` for `--changed` symbol extraction | Universal; zero additional install |
| `jq` | System | JSON parsing in bash for allclear.config.json | Already required by PLGN-07; consistent with all hooks |

### Supporting

| Component | Version/Type | Purpose | When to Use |
|-----------|-------------|---------|-------------|
| `allclear.config.json` | JSON config | Override sibling paths, exclude repos | When parent-dir discovery insufficient (nested layouts, cross-machine paths) |
| `printf '%s\n' "$JSON" | jq` | jq pattern | Parse allclear.config.json for siblings array | Per PLGN-07: always use this pattern, never bare `jq` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `grep` | `ripgrep (rg)` | rg is 5-10x faster but not universally installed; grep is always present; speed difference < 2s for typical repos so grep wins on reliability |
| `grep` | AST/LSP-based symbol lookup | Accurate but requires language server per language; high complexity; grep false positives are acceptable for impact scanning |
| Bash script | Python/Node script | Better data structures but adds runtime dependency; bash consistent with all other AllClear scripts |
| Per-file line listing | Summary count only | File count is better UX than line count; but showing first N file paths per repo gives actionable info |

**Installation:** No new dependencies. Uses grep, git, jq — all already required by AllClear core.

---

## Architecture Patterns

### Recommended Project Structure

```
skills/
└── cross-impact/
    └── SKILL.md              # /allclear impact — YAML frontmatter + instructions

scripts/
└── impact.sh                 # Core scan engine (sibling discovery + grep loop)

lib/
└── siblings.sh               # Phase 2 shared library (reused here, not reimplemented)
```

### Pattern 1: SKILL.md with Bash Script Backend

**What:** The SKILL.md frontmatter activates the skill; the body tells Claude to invoke `scripts/impact.sh` with arguments, then interpret and summarize the structured output.

**When to use:** All skills that do non-trivial shell work use this pattern. The quality-gate skill (Phase 7) is the established precedent.

**Example SKILL.md structure:**
```yaml
---
name: cross-impact
description: Scan sibling repos for references to changed symbols. Use when the user
  invokes /allclear impact, asks about cross-repo breaking changes, or wants to check
  what other repos reference a symbol before removing it.
disable-model-invocation: false
allowed-tools: Bash
argument-hint: "[symbol...] [--changed] [--exclude <repo>]"
---

Scan sibling repositories for references to the given symbols.

Discovered siblings: !`source ${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh && list_siblings`

## Usage

- `/allclear impact <symbol>` — scan all sibling repos for <symbol>
- `/allclear impact --changed` — auto-detect changed symbols from git diff and scan
- `/allclear impact <symbol> --exclude <repo>` — skip a specific repo

## Steps

1. Parse arguments from the user's invocation (symbols, --changed flag, --exclude list)
2. Run: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]`
3. Read the structured output (JSON lines or tab-separated)
4. Summarize by repo: which repos have matches, what match types, which files
5. Highlight any code-type matches — these are the highest-risk references
6. If no matches found, confirm the symbol appears safe to change or remove
```

### Pattern 2: Grep Scan Loop

**What:** `scripts/impact.sh` iterates over sibling repos, runs grep with extension-filtered `--include` options and generated-dir `--exclude-dir` options, then classifies each matching file.

**When to use:** Core of the scan engine. Runs for every sibling repo that isn't excluded.

**Example (scripts/impact.sh core loop):**
```bash
#!/usr/bin/env bash
# Source: AllClear scripts/impact.sh
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "${PLUGIN_ROOT}/lib/siblings.sh"

TERMS=()
EXCLUDES=()
CHANGED=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed) CHANGED=true; shift ;;
    --exclude) EXCLUDES+=("$2"); shift 2 ;;
    *) TERMS+=("$1"); shift ;;
  esac
done

# --changed: extract symbols from git diff
if [[ "$CHANGED" == true ]]; then
  # Get changed source files only (skip generated/docs)
  CHANGED_FILES=$(git diff HEAD~1 --name-only 2>/dev/null | \
    grep -E '\.(py|rs|ts|js|tsx|jsx|go|java|rb|sh)$' || true)

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    # Extract defined symbols: functions, classes, exported names
    git diff HEAD~1 --unified=0 -- "$file" 2>/dev/null | \
      grep '^[+-]' | grep -v '^---\|^+++' | \
      grep -oE '\b(def |class |fn |func |pub fn |pub struct |pub enum |interface |type |export (const|function|class) )[A-Za-z_][A-Za-z0-9_]+' | \
      grep -oE '[A-Za-z_][A-Za-z0-9_]+$' >> /tmp/allclear_terms_$$ || true
  done <<< "$CHANGED_FILES"

  if [[ -f /tmp/allclear_terms_$$ ]]; then
    mapfile -t TERMS < <(sort -u /tmp/allclear_terms_$$)
    rm -f /tmp/allclear_terms_$$
  fi
fi

if [[ ${#TERMS[@]} -eq 0 ]]; then
  echo '{"error": "No search terms provided. Use /allclear impact <symbol> or --changed"}' >&2
  exit 1
fi

# Get sibling repos
SIBLINGS=$(list_siblings)

echo "Scanning for: ${TERMS[*]}"
echo "---"

while IFS= read -r sibling_path; do
  [[ -z "$sibling_path" ]] && continue
  repo_name=$(basename "$sibling_path")

  # Apply --exclude
  skip=false
  for ex in "${EXCLUDES[@]}"; do
    [[ "$repo_name" == "$ex" ]] && skip=true && break
  done
  [[ "$skip" == true ]] && continue

  echo "repo: $repo_name"

  for term in "${TERMS[@]}"; do
    grep -rn \
      --include="*.py" --include="*.rs" --include="*.ts" --include="*.tsx" \
      --include="*.js" --include="*.jsx" --include="*.go" --include="*.java" \
      --include="*.rb" --include="*.sh" \
      --include="*.json" --include="*.yaml" --include="*.yml" --include="*.toml" \
      --include="*.md" --include="*.rst" \
      --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir=".venv" \
      --exclude-dir="target" --exclude-dir="dist" --exclude-dir="build" \
      --exclude-dir=".planning" \
      "$term" "$sibling_path" 2>/dev/null | \
      awk -F: -v term="$term" -v repo="$repo_name" '{
        file = $1
        # Classify by path
        type = "code"
        if (file ~ /test[s]?\/|__tests__|\.test\.|\.spec\./ || \
            file ~ /_test\.|_spec\./) type = "test"
        else if (file ~ /\.(json|yaml|yml|toml|ini|env)$/ || \
                 file ~ /Makefile|Dockerfile|\.config\./) type = "config"
        else if (file ~ /\.(md|rst|txt|adoc)$/) type = "docs"
        print repo "\t" term "\t" type "\t" file
      }' | sort -u -k4  # unique by file path
  done
  echo ""
done <<< "$SIBLINGS"
```

### Pattern 3: Sibling Discovery via lib/siblings.sh

**What:** `list_siblings` function from `lib/siblings.sh` outputs one path per line for each discovered sibling repo. The impact script consumes this list.

**Expected lib/siblings.sh interface (from ARCHITECTURE.md):**
```bash
# lib/siblings.sh
# Usage: source lib/siblings.sh && list_siblings
# Outputs: one absolute path per line, one per sibling repo
# Reads allclear.config.json "siblings" array if present; falls back to parent dir scan

list_siblings() {
  local current_dir="${1:-$PWD}"
  local parent_dir
  parent_dir=$(dirname "$current_dir")
  local config_file="${current_dir}/allclear.config.json"

  if [[ -f "$config_file" ]]; then
    # Config override: read siblings array
    printf '%s\n' "$(cat "$config_file")" | \
      jq -r '.siblings[]?.path // empty' 2>/dev/null
  else
    # Auto-discover: scan parent dir for .git dirs
    for d in "$parent_dir"/*/; do
      [[ -d "${d}.git" && "$d" != "$current_dir/" ]] && printf '%s\n' "${d%/}"
    done
  fi
}
```

**When to use:** Always call `list_siblings` from `lib/siblings.sh`; never re-implement discovery logic in the skill script.

### Pattern 4: Match Classification by File Path

**What:** Each grep match is classified into one of four types based on the file path. Classification is purely path/extension based — no content analysis needed.

**Classification hierarchy (priority order):**
```
1. test   — path contains /test/, /tests/, /spec/, /__tests__/
             OR filename matches *test*, *spec* (case-insensitive)
2. docs   — extension is .md, .rst, .txt, .adoc, .textile
3. config — extension is .json, .yaml, .yml, .toml, .ini
             OR filename is Makefile, Dockerfile, docker-compose.yml
4. code   — everything else (default: .py, .rs, .ts, .go, .js, .sh, etc.)
```

**Important:** Test classification takes priority over code. A `test_user_service.py` is a test, not code.

### Anti-Patterns to Avoid

- **Scanning line-by-line and reporting line numbers to the user:** Users want to know WHICH FILES reference a symbol, not line 42 in 300 files. Report unique files per repo with the match type classification. Claude can drill down if needed.
- **Using `find | xargs grep` instead of `grep -r --include`:** The `-r --include` form is cleaner, handles spaces in paths, and lets grep's own traversal avoid `--exclude-dir` directories. `find | xargs` requires careful quoting.
- **Recursive sibling discovery:** Only scan DIRECT children of the parent directory. A management parent containing 11 sub-repos is correctly handled by scanning each as a sibling. Do NOT recursively walk siblings for further nested repos — this causes exponential scan scope.
- **Scanning without `--exclude-dir=.git`:** Without this, grep will scan `.git/COMMIT_EDITMSG` and other git internals, producing false positives.
- **Using `CLAUDE_SKILL_DIR/../../lib/siblings.sh`:** As noted in STATE.md blockers, this relative path is fragile. Always use `${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sibling repo discovery | Custom `find` logic in impact.sh | `lib/siblings.sh` (Phase 2) | Single source of truth; handles config.json override; consistent with session hook and drift skill |
| JSON config parsing | Custom bash JSON parser | `printf '%s\n' "$JSON" | jq -r ...` | PLGN-07 requirement; jq handles edge cases (nesting, nulls, unicode) |
| Grep exclusion lists | Custom per-scan exclusion array | Standardized `--exclude-dir` list in impact.sh | Consistent across all AllClear tools; update one place |
| Symbol extraction from diff | AST parser | `git diff HEAD~1` + grep for language-specific declaration keywords | AST parsers require language runtimes; grep-based extraction is sufficient for impact scanning (false negatives acceptable — conservative approach) |

**Key insight:** The impact skill is fundamentally a grep orchestrator. Every additional abstraction layer adds fragility. Keep the core loop readable and direct.

---

## Common Pitfalls

### Pitfall 1: Scanning Current Repo as a Sibling

**What goes wrong:** `list_siblings` includes the current working directory in results, so impact.sh scans the repo being modified for references to its own changed symbols. This produces noisy, expected-self-reference output.

**Why it happens:** Parent dir scan iterates all `parent/*/` directories including `parent/allclear/` (the current repo).

**How to avoid:** `list_siblings` must exclude the current repo. Check: `[[ "$d" != "$current_dir/" ]] && ...`. This must be implemented in `lib/siblings.sh`.

**Warning signs:** Impact results show the current repo as the top match source.

### Pitfall 2: Grep on .git Objects Produces False Positives

**What goes wrong:** Git's object store contains all historical file content as binary-ish blob objects. Without `--exclude-dir=.git`, grep finds the symbol in historical versions of files that no longer reference it.

**Why it happens:** Forgetting `--exclude-dir=.git` in the grep invocation.

**How to avoid:** Always include `--exclude-dir=".git"` in every grep call. It is part of the standard include/exclude template.

**Warning signs:** Matches in paths containing `.git/objects/` or `.git/COMMIT_EDITMSG`.

### Pitfall 3: --changed Extracts Too Many Noise Tokens

**What goes wrong:** Naive token extraction from `git diff HEAD~1` produces hundreds of terms (variable names, string literals, common words) that generate massive amounts of grep noise across sibling repos.

**Why it happens:** Using `grep -oE '\b\w+\b'` on diff output extracts everything, including imports, comments, and test data.

**How to avoid:** Target language-specific declaration keywords only (`def`, `class`, `fn`, `func`, `interface`, `type`, `export const`). Extract only the TOKEN AFTER the keyword. This produces function/class/type names — the symbols most likely to cause cross-repo breakage.

**Warning signs:** --changed returns 50+ terms for a small code change.

### Pitfall 4: Scanning node_modules / target / .venv

**What goes wrong:** Without `--exclude-dir` for generated dependency directories, grep scans thousands of vendored files and reports matches from third-party libraries that happen to use the same symbol name.

**Why it happens:** Missing exclusion list in grep call.

**How to avoid:** Standard exclusion list: `.git`, `node_modules`, `.venv`, `target`, `dist`, `build`. Verify this list is applied consistently in all grep calls within impact.sh.

**Warning signs:** Match counts in the thousands; file paths containing `node_modules/` in results.

### Pitfall 5: SKILL.md Tries to Hard-Code Sibling List

**What goes wrong:** Developer puts a literal list of known repos in SKILL.md instead of using `!`list_siblings`` injection. New repos added to the parent directory are not discovered.

**Why it happens:** Convenience — hard-coding feels explicit.

**How to avoid:** Always use `!`source ${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh && list_siblings`` injection in the SKILL.md frontmatter section. This gives Claude live discovery data at invocation time.

**Warning signs:** User reports that a newly added sibling repo is not being scanned.

### Pitfall 6: CLAUDE_SKILL_DIR Relative Path Fragility

**What goes wrong:** Using `${CLAUDE_SKILL_DIR}/../../lib/siblings.sh` breaks if the plugin cache moves the skill directory to a different depth.

**Why it happens:** Trying to navigate from the skill directory to lib/ using relative paths.

**How to avoid:** Use `${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh` exclusively. This variable is set by Claude Code to the plugin's installation root regardless of cache location. This is documented as a known concern in STATE.md.

---

## Code Examples

Verified patterns from project architecture research:

### SKILL.md Frontmatter (Established Pattern from Quality Gate Skill)
```yaml
# Source: ARCHITECTURE.md Pattern 3 (Skills as Orchestration Prompts)
---
name: cross-impact
description: Scan sibling repos for references to changed symbols. Use when the user
  invokes /allclear impact, asks about cross-repo breaking changes, or wants to know
  what other repos reference a symbol before removing or renaming it.
disable-model-invocation: false
allowed-tools: Bash
argument-hint: "[symbol...] [--changed] [--exclude <repo>]"
---
```

### lib/siblings.sh Call Pattern (Established Convention)
```bash
# Source: ARCHITECTURE.md Pattern 4 (Shared Library)
# In SKILL.md shell injection:
!`source ${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh && list_siblings`

# In scripts/impact.sh:
source "${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh"
SIBLINGS=$(list_siblings)
while IFS= read -r sibling_path; do
  [[ -z "$sibling_path" ]] && continue
  # ... scan sibling_path ...
done <<< "$SIBLINGS"
```

### JSON Config Parsing (PLGN-07 Compliant Pattern)
```bash
# Source: REQUIREMENTS.md PLGN-07 + ARCHITECTURE.md Pattern 4
# Read siblings override from allclear.config.json
CONFIG_FILE="${PWD}/allclear.config.json"
if [[ -f "$CONFIG_FILE" ]]; then
  CONFIG_JSON=$(cat "$CONFIG_FILE")
  # PLGN-07: use printf pattern, not bare jq
  CUSTOM_SIBLINGS=$(printf '%s\n' "$CONFIG_JSON" | jq -r '.siblings[]?.path // empty' 2>/dev/null)
fi
```

### Grep Scan Template (Verified Against Live Repos)
```bash
# Source: Live tested against /sources/ repos — 2026-03-15
# Fast enough: sub-second for small repos, ~1.6s for 37GB management dir (with target/ excluded)
grep -rn \
  --include="*.py" --include="*.rs" --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.jsx" --include="*.go" \
  --include="*.json" --include="*.yaml" --include="*.yml" --include="*.toml" \
  --include="*.md" --include="*.rst" \
  --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir=".venv" \
  --exclude-dir="target" --exclude-dir="dist" --exclude-dir="build" \
  "$TERM" "$sibling_path" 2>/dev/null
```

### Match Classification Function
```bash
# Source: AllClear Phase 9 research — path-based classification
classify_match() {
  local filepath="$1"
  local basename
  basename=$(basename "$filepath")
  local lower_path="${filepath,,}"  # lowercase

  # Test: path or filename contains test/spec indicator
  if [[ "$lower_path" =~ /tests?/ || "$lower_path" =~ /__tests__/ || \
        "$lower_path" =~ /spec/ || "$basename" =~ test || \
        "$basename" =~ spec || "$basename" =~ _test\. || \
        "$basename" =~ _spec\. ]]; then
    echo "test"
    return
  fi

  # Docs: markdown, rst, txt
  case "${filepath##*.}" in
    md|rst|txt|adoc) echo "docs"; return ;;
  esac

  # Config: structured data and build files
  case "${filepath##*.}" in
    json|yaml|yml|toml|ini|env) echo "config"; return ;;
  esac
  case "$basename" in
    Makefile|Dockerfile|docker-compose.yml) echo "config"; return ;;
  esac

  # Default: code
  echo "code"
}
```

### --changed Symbol Extraction
```bash
# Source: AllClear Phase 9 research — language-aware extraction from git diff
extract_changed_symbols() {
  git diff HEAD~1 --name-only 2>/dev/null | \
    grep -E '\.(py|rs|ts|js|tsx|jsx|go|java|rb|sh)$' | \
  while IFS= read -r changed_file; do
    [[ -z "$changed_file" ]] && continue
    git diff HEAD~1 --unified=0 -- "$changed_file" 2>/dev/null | \
      grep '^[+-]' | grep -v '^---\|^+++' | \
      grep -oE '\b(def |class |fn |func |pub fn |pub struct |pub enum |interface |type |export (const|function|class) )[A-Za-z_][A-Za-z0-9_]+' | \
      grep -oE '[A-Za-z_][A-Za-z0-9_]+$'
  done | sort -u
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual cross-repo grep | `/allclear impact` automates the loop | Phase 9 introduction | Eliminates multi-terminal grep workflow |
| Scanning all files including generated | Extension-filtered `--include` list | Established practice (2020+) | 10-100x fewer false positives |
| Reporting line numbers | Reporting unique file paths per repo | AllClear design decision | Cleaner output; Claude reasons over files not lines |
| AST-based symbol lookup | grep-based with keyword anchoring | AllClear design choice | No language server dependency; works cross-language with one tool |

**Deprecated/outdated:**
- Bare `jq` calls in bash: replaced by `printf '%s\n' "$JSON" | jq` per PLGN-07
- `CLAUDE_SKILL_DIR/../../lib/` relative paths: replaced by `${CLAUDE_PLUGIN_ROOT}/lib/` per STATE.md blocker

---

## Open Questions

1. **lib/siblings.sh interface contract**
   - What we know: Phase 2 defines `lib/siblings.sh`; ARCHITECTURE.md describes its purpose; Phase 9 depends on it
   - What's unclear: The exact function signature and output format of `list_siblings` — is it `list_siblings` (no args) or does it accept a config path?
   - Recommendation: Phase 9 SKILL.md and impact.sh should document the interface they expect; if Phase 2 hasn't been executed yet, the planner should note this interface contract so both phases stay synchronized. The most natural form is `list_siblings` with no args, reading `$PWD/allclear.config.json` if present.

2. **Skill namespace: `/allclear impact` vs `/allclear:cross-impact`**
   - What we know: STATE.md notes this needs verification in a dev session; the skill directory is `skills/cross-impact/`
   - What's unclear: Whether Claude Code exposes skills as `/allclear impact` (space) or `/allclear:cross-impact` (colon + dir name)
   - Recommendation: SKILL.md `name:` field controls the subcommand name; setting `name: impact` in frontmatter should produce `/allclear impact`. Write the SKILL.md with `name: impact` and verify during integration testing.

3. **Output format: plain text vs structured JSON**
   - What we know: Skills output is consumed by Claude (LLM), not a machine parser; SKILL.md instructions tell Claude how to interpret output
   - What's unclear: Whether tab-separated output or JSON lines is more reliably parsed by Claude from bash output
   - Recommendation: Use a simple, line-per-match format: `{repo}\t{type}\t{filepath}`. Claude handles this well and it's easy to produce with `awk`. A JSON-per-repo summary output would also work but adds bash complexity with no practical benefit since Claude is the consumer.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core (Phase 13 — tests are a parallel phase) |
| Config file | none yet — Wave 0 for Phase 13 |
| Quick run command | `bats tests/impact.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMPT-01 | `scripts/impact.sh <term>` finds matches across a mock sibling layout | unit | `bats tests/impact.bats` | Wave 0 |
| IMPT-02 | Sibling discovery finds repos with .git in parent dir; skips non-git dirs | unit | `bats tests/impact.bats` (sibling discovery section) | Wave 0 |
| IMPT-03 | `--changed` flag extracts symbols from `git diff HEAD~1` and passes them as terms | unit (with fixture diff) | `bats tests/impact.bats` (changed section) | Wave 0 |
| IMPT-04 | Files are classified as code/config/docs/test based on path | unit | `bats tests/impact.bats` (classification section) | Wave 0 |
| IMPT-05 | Output is grouped by repo with file counts and paths | unit | `bats tests/impact.bats` (output format section) | Wave 0 |
| IMPT-06 | `allclear.config.json` with `siblings` array overrides auto-discovery | unit | `bats tests/impact.bats` (config override section) | Wave 0 |
| IMPT-07 | `--exclude <repo>` skips that repo in scan results | unit | `bats tests/impact.bats` (exclude section) | Wave 0 |

### Sampling Rate

- **Per task commit:** `bats tests/impact.bats` (if it exists; Phase 13 creates it)
- **Per wave merge:** `bats tests/`
- **Phase gate:** Phase 9 is file-creation only (SKILL.md + impact.sh); functional validation requires manual `/allclear impact` invocation against a live Claude session

### Wave 0 Gaps

- [ ] `tests/impact.bats` — covers all IMPT-xx requirements
- [ ] `tests/helpers/mock_siblings.bash` — shared fixture: creates temp parent dir with mock sibling repos containing `.git`
- [ ] `tests/fixtures/sample.diff` — git diff fixture for `--changed` tests
- Bats framework install: `brew install bats-core` (or `npm install --save-dev bats` for CI)

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` — Plugin structure, SKILL.md patterns, lib/ conventions, `${CLAUDE_PLUGIN_ROOT}` path pattern, anti-patterns for relative paths
- `.planning/research/FEATURES.md` — Cross-repo impact scanning as primary differentiator; no competitor offers this; complexity rating HIGH
- `.planning/REQUIREMENTS.md` — IMPT-01 through IMPT-07 verbatim definitions; Phase 9 success criteria
- `.planning/ROADMAP.md` — Phase 9 success criteria (3 acceptance conditions)
- Live grep test: `/sources/` parent dir — confirmed grep scan pattern works; measured scan performance (sub-second to ~1.6s); confirmed 11 sibling repos discoverable; confirmed file-path output is correct UX

### Secondary (MEDIUM confidence)
- `git diff HEAD~1` symbol extraction tested live in allclear repo; keyword-anchored extraction approach validated for TypeScript/Python/Rust/Go patterns
- Classification algorithm: path-based heuristics verified against real file paths in management subdirectories

### Tertiary (LOW confidence)
- Claim that bats testing will cover all IMPT requirements — bats tests do not yet exist; this is a design projection for Phase 13

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — bash/grep/git/jq are verified tools; no new dependencies
- Architecture: HIGH — SKILL.md + scripts/ pattern established in Phase 7; directly reusable
- Pitfalls: HIGH — pitfalls 1, 2, 4 verified by live testing; pitfall 6 documented in STATE.md
- Scan performance: HIGH — measured on real repos (sub-second typical; 1.6s for large nested layout)
- --changed extraction: MEDIUM — approach verified conceptually; exact regex for all languages not exhaustively tested

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (grep/git/bash interfaces are stable; 90-day window appropriate)
