#!/usr/bin/env python3
"""
Conservative ticket-ID stripper for source code.

Design principles:
- Only modify lines that contain a ticket-ID match.
- NEVER touch whitespace beyond what's adjacent to the matched tag.
- NEVER strip whitespace from non-matching lines.
- NEVER collapse columnar formatting (multiple spaces).
- Run `node --check` after each file; revert on any parse failure.

Patterns handled:
1. Leading-comment-tag forms: `// AUTH-01: foo`, `* AUTH-01: foo`,
   `// AUTH-01 / THE-1029: foo` → strip the tag prefix, keep "foo".
2. Trailing-line-comment tags: `code, // TRUST-01` → strip the comment.
   But ONLY if the comment is JUST the tag (with optional " — context" or
   " (context)") — don't strip useful explanatory comments.
3. Mid-comment parenthetical tags: `// foo (HUB-01) bar` → `// foo bar`
   (only inside lines that are comment-prefixed).
4. Phase NN references in comments → strip.
5. Plan NN references in comments → strip.
"""

import os
import re
import subprocess
import sys

TAG_PREFIX = (
    r"(?:THE|AUTH|PII|VER|TRUST|SHADOW|FRESH|HUB|UPD|NAV|HOK|HELP|"
    r"INST|DEP|SSE|CLN|INT|CORRECT|SREL|AGENT|GENF|UTIL|SCH|ENH|FIX|"
    r"REL|AUTHDB|MF|LANG|TYPE|ENR|DSP|RES|SRC|ENV|PATH|PKG|TST|DOC|"
    r"README)"
)
TAG_SUFFIX = r"-\d+(?:-(?:\d+|unit|impl|bats|setup|teardown))*"

# A complete tag ID
TAG_RE = re.compile(r"\b" + TAG_PREFIX + TAG_SUFFIX + r"\b")
# M-AUTH-NN, S-AUTH-NN test labels
MS_TAG_RE = re.compile(r"\b[MS]-AUTH-\d+\b")
# D-NN-NN decision IDs
D_TAG_RE = re.compile(r"\bD-\d+(?:-\d+)?\b")
PHASE_RE = re.compile(r"\bPhase \d+(?:-\d+)?\b")
PLAN_RE = re.compile(r"\bPlan \d+(?:-\d+)?\b")
# Mitigation parenthetical: (S1 mitigation), (X1), (M1 ...), (C2 option-a)
MIT_PARENS_RE = re.compile(r"\(\s*[SMXCL]\d+(?:\s+[^)]*)?\s*\)")
MIT_BARE_RE = re.compile(r"\(\s*C\d+\s+(?:option-[a-z]|spread-merge|regression)[^)]*\)")


def is_full_line_comment(line):
    """Line is a comment in JS, bash, or Bats syntax."""
    s = line.lstrip()
    if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
        return True
    # Bash / Bats: lines starting with # (but not shebang #! at the very start)
    if s.startswith("#") and not s.startswith("#!"):
        return True
    return False


def split_inline_comment(line):
    """
    Find the position of `//` that starts an inline comment in JS.
    Returns (code_part, comment_part) or (line, None) if no inline comment.
    Naive: assumes // is not inside a string. Good enough for our codebase.
    """
    # Find first `//` not inside a string
    in_str = None
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        else:
            if ch in ('"', "'", "`"):
                in_str = ch
            elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                # Found //
                return line[:i], line[i:]
        i += 1
    return line, None


def strip_tags_from_text(text):
    """Strip all known tag patterns from a text segment."""
    text = TAG_RE.sub("", text)
    text = MS_TAG_RE.sub("", text)
    text = D_TAG_RE.sub("", text)
    text = PHASE_RE.sub("", text)
    text = PLAN_RE.sub("", text)
    text = MIT_PARENS_RE.sub("", text)
    text = MIT_BARE_RE.sub("", text)
    # Cleanup post-strip cruft (only adjacent to where strips happened)
    text = re.sub(r"\(\s*[/,]\s*\)", "", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\(\s*,\s*", "(", text)
    text = re.sub(r"\s*,\s*\)", ")", text)
    text = re.sub(r"\s+/\s*\)", ")", text)
    text = re.sub(r"\(\s*/\s+", "(", text)
    text = re.sub(r"\s+/\s+,", ",", text)
    text = re.sub(r"\s+,\s+", ", ", text)  # normalize ", "
    # Collapse double-space ONLY at the start of stripped section (won't affect aligned columns)
    # Actually we don't do this — too risky. Leave the spaces.
    return text


def line_has_tags(line):
    return bool(
        TAG_RE.search(line)
        or MS_TAG_RE.search(line)
        or D_TAG_RE.search(line)
        or PHASE_RE.search(line)
        or PLAN_RE.search(line)
        or MIT_PARENS_RE.search(line)
        or MIT_BARE_RE.search(line)
    )


_TEST_TAG_PREFIX = re.compile(
    # JS test()/it()/describe() OR bats @test "..."
    r"^(\s*(?:(?:test|it|describe|it\.skip|test\.skip)\s*\(\s*['\"`]|@test\s+['\"`]))"
    r"(?:THE|AUTH|PII|VER|TRUST|SHADOW|FRESH|HUB|UPD|NAV|HOK|HELP|INST|DEP|"
    r"SSE|CLN|INT|CORRECT|SREL|AGENT|GENF|UTIL|SCH|ENH|FIX|REL|AUTHDB|MF|"
    r"LANG|TYPE|ENR|DSP|RES|SRC|ENV|PATH|PKG|TST|DOC|README|M-AUTH|S-AUTH)"
    r"-\d+(?:-(?:\d+|unit|impl|bats|setup|teardown))*"
    # Optional follow-on tags: another full tag, OR a short alphanumeric sub-label like A1/S2/C3
    r"(?:\s+(?:THE|AUTH|PII|VER|TRUST|SHADOW|FRESH|HUB|UPD|NAV|HOK|HELP|"
    r"INST|DEP|SSE|CLN|INT|CORRECT|SREL|AGENT|M-AUTH|S-AUTH)-\d+(?:-(?:\d+|unit|impl|bats|setup|teardown))*)*"
    # Optional sub-label (e.g. " A1", " S2", " C3", " M-AUTH-04")
    r"(?:\s+[A-Z][0-9]+)?"
    # Optional parenthetical tag like (C3), (option-a)
    r"(?:\s*\((?:[A-Z][0-9]+|option-[a-z]|[a-z][\w-]*)\))?"
    r"\s*[:—\-]\s*"
)


def strip_test_name_tag(line):
    """Strip a leading tag-prefix from test()/it()/describe() string literals.

    test('PII-07-1: maskHome — foo', () => {  →  test('maskHome — foo', () => {
    """
    return _TEST_TAG_PREFIX.sub(r"\1", line)


def process_line(line):
    """Strip tags. For full-line comments, strip aggressively. For inline
    comments, only strip the comment portion. For test() strings, strip
    the leading tag from the description. Don't touch other code."""
    # First handle test() string with tag prefix
    new_line = strip_test_name_tag(line)
    if new_line != line:
        return new_line
    if not line_has_tags(line):
        return line
    has_newline = line.endswith("\n")
    body = line[:-1] if has_newline else line
    if is_full_line_comment(line):
        # Strip tags from the entire comment line (preserving leading whitespace + comment marker)
        m = re.match(r"^(\s*(?://\s*|\*\s*|/\*\s*|#\s*))(.*)$", body)
        if m:
            prefix, content = m.group(1), m.group(2)
            new_content = strip_tags_from_text(content)
            # Strip leading dash/bullet/colon/slash left after a tag was at the start
            new_content = re.sub(r"^[ \t—\-:/]+", "", new_content)
            result = prefix + new_content
            return result + ("\n" if has_newline else "")
        return strip_tags_from_text(line)
    # Else: inline comment within a code line
    code_part, comment_part = split_inline_comment(line)
    if comment_part is None:
        # Tag in a code line but no // comment — leave alone (could be a string)
        return line
    new_comment = strip_tags_from_text(comment_part)
    # If the comment is now empty or just `//` with whitespace, drop the comment entirely
    stripped_comment = re.sub(r"^//\s*", "", new_comment).strip()
    if stripped_comment == "" or re.match(r"^[—\-:/]+$", stripped_comment):
        # Empty / just-cruft comment — drop it
        return code_part.rstrip() + ("\n" if line.endswith("\n") else "")
    # Re-attach comment, normalize comment-marker spacing
    return code_part + "// " + stripped_comment + ("\n" if line.endswith("\n") else "")


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: strip-ticket-ids.py <file> [<file>...]", file=sys.stderr)
        sys.exit(1)

    failed = []
    total_lines_changed = 0
    for fp in files:
        if not os.path.isfile(fp):
            print(f"  SKIP missing: {fp}")
            continue
        with open(fp) as f:
            original = f.read()
        original_lines = original.splitlines(keepends=True)
        new_lines = [process_line(ln) for ln in original_lines]
        new = "".join(new_lines)
        if new == original:
            continue
        with open(fp, "w") as f:
            f.write(new)
        diffs = sum(1 for a, b in zip(original_lines, new_lines) if a != b)
        print(f"  edited: {fp} ({diffs} lines)")
        total_lines_changed += diffs
        check_cmd = None
        if fp.endswith(".js"):
            check_cmd = ["node", "--check", fp]
        elif fp.endswith(".sh") or fp.endswith(".bash"):
            check_cmd = ["bash", "-n", fp]
        # .bats files have non-bash syntax (@test "..."); skip parse-check.
        # Tests will catch any breakage.
        if check_cmd:
            result = subprocess.run(
                check_cmd,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                print("    *** PARSE FAIL — REVERTING ***", file=sys.stderr)
                print(result.stderr, file=sys.stderr)
                with open(fp, "w") as f:
                    f.write(original)
                failed.append(fp)
    print(f"\nTotal lines changed: {total_lines_changed}")
    if failed:
        print(f"Reverted {len(failed)} files:", failed, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
