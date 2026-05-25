# Fortress WASM — Agent Guidelines

This file is the authoritative reference for any agent working on this repository. Read it in full before making any changes. These rules are non-negotiable and apply to every task regardless of scope.

---

## Language

All written output — commit messages, changelog entries, comments, documentation, README, error messages, console output, and any user-facing strings — must use **Australian English**.

Common differences to watch:

| American | Australian |
|---|---|
| optimize | optimise |
| initialize | initialise |
| recognize | recognise |
| behavior | behaviour |
| color | colour |
| favorite | favourite |
| utilize | utilise |
| serialize | serialise |
| analyze | analyse |
| center | centre |
| license (noun) | licence |
| defense | defence |

If you are unsure whether a word follows Australian spelling, check — do not default to American English. Any existing American English found in documentation or comments should be corrected as part of whatever task you are working on.

---

## Versioning

Fortress WASM follows [Semantic Versioning](https://semver.org) strictly. Every release must be classified correctly before tagging and publishing.

### Version classification rules

**Patch** (`1.4.0` → `1.4.1`)
- Bug fixes that do not change any public API or behaviour
- Performance improvements with no API changes
- Documentation corrections
- Test additions or fixes
- Auto-updates silently for all users on caret ranges

**Minor** (`1.4.0` → `1.5.0`)
- New features that are fully backwards compatible
- New framework integrations
- New CLI commands or flags
- Deprecation notices (not removals)
- Auto-updates silently for all users on caret ranges

**Major** (`1.4.0` → `2.0.0`)
- Breaking changes to any public API
- Changes to the bytecode format or FVM instruction set
- Changes to the handshake protocol or session key derivation
- Removal of deprecated features
- Changes that require users to recompile their protected functions
- Does NOT auto-update — users must explicitly opt in

### When in doubt, ask

If a change could plausibly break existing compiled payloads, existing server/client integrations, or any public API surface, treat it as a major version. Do not bump a minor version for something that requires user action to migrate.

### The client/server compatibility rule

The client SDK version and the server scrambler version must always be compatible. Any change to the handshake protocol, session key format, or payload encryption scheme that breaks compatibility between existing client and server versions is a major version bump, full stop.

---

## Release Checklist

Every release — patch, minor, or major — must complete this checklist in order. Do not tag or push until every item is done.

1. All tests pass — run the full verification pipeline:
   ```bash
   cargo test --manifest-path crates/vm-core/Cargo.toml
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run build:prod
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:full
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:e2e
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:transpiler
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:stdlib
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:opcodes
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:annotations
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:verify
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:cli-integration
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:integrations
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:dev-server
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:complex
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:sdk
   FORTRESS_SIGNING_PASSWORD=validpassword123 node --test tests/native_call.test.js
   FORTRESS_SIGNING_PASSWORD=validpassword123 npm run test:browser
   npm audit --audit-level=moderate
   cargo audit
   cargo deny check
   ```

1a. Sync all sub-package versions to match root:
   ```bash
   node scripts/sync-versions.js --fix
   ```
   Confirm output shows all sub-packages updated — no drift remaining.
   The following sub-packages must always match the root version exactly:
   - `packages/create-fortress-app/package.json`
   - `packages/sdk/package.json`

2. `package.json` version is updated to the new version number

3. `CHANGELOG.md` is updated with a new section for this version (see changelog rules below)

4. Version bump is committed: `chore: bump version to X.Y.Z`

5. Tag is created: `git tag vX.Y.Z`

6. Everything is pushed: `git push origin main && git push origin vX.Y.Z`

7. GitHub Actions publish workflow has triggered and succeeded for the new tag. Confirm by checking `.github/workflows/publish.yml` to verify the trigger condition matches the tag format pushed, and report the expected workflow URL: `https://github.com/lkeld/fortress-wasm/actions`

8. If the workflow fails because `FORTRESS_SIGNING_PASSWORD` is not set in GitHub Actions secrets, report this clearly — do not attempt workarounds

9. After the workflow succeeds, confirm the new version is live by running:
   ```bash
   npm view @lkeld/fortress-wasm version --registry https://npm.pkg.github.com/
   ```
   If this requires authentication, note that GitHub Packages requires a token with `read:packages` scope — report the version number from the workflow logs instead

---

## Changelog

`CHANGELOG.md` must be kept up to date on every release. It is not optional and it is not a summary — it is the authoritative record of what changed and why.

### Format

Every version section follows this structure:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- Description of new feature or capability

### Changed
- Description of changed behaviour (note: not "behavior")

### Fixed
- Description of bug that was fixed

### Security
- Description of any security fix — always include the severity and what was at risk

### Deprecated
- Description of anything being deprecated and what to use instead

### Removed
- Description of anything removed (major versions only typically)
```

Only include headings that are relevant to the release. Do not include an empty `### Added` section if nothing was added.

### Rules

- Every entry is a complete sentence written in past tense
- Every entry uses Australian English
- Security fixes always go under `### Security` with enough detail that a user understands what was at risk and what was fixed
- Do not write vague entries like "various bug fixes" or "performance improvements" — be specific about what was fixed and where
- Breaking changes in a major version must include a migration note explaining exactly what the user needs to do
- Date format is `YYYY-MM-DD` — not "May 2025", not "25/05/2025"

### Example of a good entry

```markdown
## [1.4.0] — 2026-05-25

### Security
- Fixed session key zeroization bug in `server/scrambler.ts` where the derived
  HKDF session key was being wiped to zeroes before being returned to the caller,
  causing the VM to decrypt payloads with an all-zero key and produce garbage
  opcodes. The key is now cloned before zeroization.
- Fixed remote code execution surface in `verifyEquivalence` where transpiled
  code was executed via `new Function()` in the main Node.js process. Production
  builds now throw if this function is called. Development builds use the Node
  built-in `vm` module as a sandboxed alternative.

### Fixed
- Fixed strict equality semantics — `===` and `!==` now compile to dedicated
  `StrictEq` and `StrictNeq` VM opcodes rather than being downgraded to loose
  equality, which previously caused type-coercion bypasses in authentication checks.
- Fixed closure mutations not propagating back to the parent scope when closed-over
  variables were serialised across the VM boundary.
```

### Example of a bad entry

```markdown
## [1.4.0] — May 2026

### Fixed
- Fixed some security issues
- Various transpiler improvements
- Performance optimizations
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org) on every commit.

Format: `type(scope): description`

Types:
- `feat` — new feature
- `fix` — bug fix
- `chore` — maintenance, version bumps, dependency updates
- `docs` — documentation only
- `refactor` — code restructuring with no behaviour change
- `test` — test additions or fixes
- `security` — security fix (use this over `fix` when the change addresses a vulnerability)
- `perf` — performance improvement

Scope is optional but preferred — use the affected area: `sdk`, `vm`, `transpiler`, `cli`, `dx`, `server`, `docs`.

Descriptions are written in imperative present tense in Australian English: "add version mismatch warning" not "added version mismatch warning" and not "adds version mismatch warning".

Do not end descriptions with a full stop.

---

## Documentation

Any change that affects a public API, CLI command, configuration option, or user-facing behaviour must include a documentation update in the same commit or PR. Code changes without documentation updates for user-facing features are incomplete.

Files to keep updated:
- `README.md` — overview, quick start, framework support
- `docs/cli.md` — CLI commands and flags
- `docs/config.md` — `fortress.config.js` options
- `docs/frameworks.md` — framework integration guides
- `docs/js-transpiler.md` — transpiler capability matrix
- `docs/transpiler.md` — transpiler limitations
- `docs/security-model.md` — security architecture
- `CHANGELOG.md` — every release
- `SECURITY.md` — threat model and responsible disclosure

---

## Security Rules

These rules apply to every task regardless of whether the task is security-related. Violations of these rules are never acceptable.

- **Never commit debug logging that prints key material.** Any `console.log`, `eprintln!`, or equivalent that outputs session keys, shared secrets, HMAC values, private keys, or derived key bytes must be removed before committing. During debugging these are acceptable temporarily — they must always be cleaned up before the commit is staged.
- **Never leave scratch scripts or temporary files in the repository.** Any file created for debugging purposes — test scripts, scratch files, temporary outputs — must be deleted before committing. Run `git status` before every commit and remove anything that should not be there.
- **Verify production gating actually works.** Any function or code path gated on `NODE_ENV === 'production'` or a similar environment check must be verified to be genuinely unreachable in production builds before committing. Do not assume the gate works — confirm it.
- **`verifyEquivalence` must never be reachable from untrusted input in any production code path.** If any refactoring creates a path where this function could be called in production, that is a critical bug and must be fixed before committing.
- **Signing key files must never be committed.** `.signing_params`, `.signing_key`, `.fortress_dev_key`, and any file containing derived key material must remain gitignored. Verify these files are not staged before every commit.

---

## ISA and VM Consistency Rules

When modifying the instruction set or VM internals, the following files must all be updated in the same commit. Partial updates are bugs waiting to happen.

- **New opcode added to ISA** → update all of: `scripts/generate_isa.js`, `crates/vm-core/src/opcodes.rs`, `crates/vm-core/src/dispatch_table.rs`, `crates/vm-core/src/handlers/`, and critically **`server/scrambler.ts` boundary guard switch statement**. The scrambler boundary guard caused the original critical bug in this codebase — missing an opcode there will cause silent data corruption at page boundaries.
- **New `VmError` variant added** → update the error mapping in `crates/vm-core/src/wrapper.rs` in the same commit. An unmapped variant will panic at the WASM boundary instead of returning a structured error.
- **Rust VM source changed** → rebuild WASM binaries and commit the outputs. The following files must be regenerated and staged: `pkg-node/vm_core_bg.wasm`, `pkg-node/vm_core_bg.wasm.sha384`, `pkg-web/vm_core_bg.wasm`, `pkg-web/vm_core_bg.wasm.sha384`, `WASM_INTEGRITY.txt`. Code changes to the VM without updated binaries leave the repository in an inconsistent state.

---

## Testing Rules

- **Always set `FORTRESS_SIGNING_PASSWORD` when running tests.** Without it the Rust build fails in ways that produce misleading errors. Every test command must be prefixed with `FORTRESS_SIGNING_PASSWORD=validpassword123`. If a test is run without it and appears to pass, the result is not trustworthy.
- **Never mark a task complete based on a subset of tests.** All suites in the verification pipeline must pass. Running only the directly related tests is not sufficient — any change can introduce regressions in unexpected places.
- **Skipped tests are not passing tests.** If any test is skipped rather than passing, report it explicitly. A suite that reports "10 passed, 2 skipped" is not a clean pass — investigate why tests were skipped before declaring success.
- **Do not rely on cached build outputs.** Before running the final verification pipeline on any task that touched Rust or WASM code, run a clean production build: `FORTRESS_SIGNING_PASSWORD=validpassword123 npm run build:prod`. Stale WASM binaries will cause tests to pass locally but fail in CI.

---

## Repository Hygiene Rules

- **Read `AGENTS.md` at the start of every task** before touching any file. These rules apply regardless of what the task description says.
- **Run `git status` before every commit.** Confirm that only the intended files are staged. Nothing temporary, nothing generated that should be gitignored, nothing left over from debugging.
- **Run `git diff --stat` before every commit.** Confirm the scope of changes matches the intent of the task. If significantly more files changed than expected, investigate before committing.
- **Do not commit American English.** Before committing any documentation, changelog entry, comment, or user-facing string, check for American spellings. The language table in the Language section of this file is the reference.
- **No self-dependency in package.json.** The root `package.json` must never list `@lkeld/fortress-wasm` in its own `dependencies` or `devDependencies`. This prevents circular lookup and authentication failures during remote CI/CD installation steps.

---

## GitHub Actions Rules

- **If a workflow failed for a previous tag push, the tag must be deleted and recreated after fixing the failure.** Pushing a fix to `main` without moving the tag will not re-trigger the workflow. Delete the remote tag (`git push origin :refs/tags/vX.Y.Z`), delete the local tag (`git tag -d vX.Y.Z`), recreate it (`git tag vX.Y.Z`), and push again (`git push origin vX.Y.Z`).
- **Always check `publish.yml` to confirm the trigger condition matches the tag format being pushed.** The workflow triggers on tags matching `v*` — a tag named anything else will not trigger it.
- **Report workflow failures clearly.** If the workflow fails, state the failure reason explicitly. The most common cause is a missing `FORTRESS_SIGNING_PASSWORD` secret in GitHub Actions — if this is the case, say so and provide the path to add it: `https://github.com/lkeld/fortress-wasm/settings/secrets/actions`.
- **Do not attempt to work around a failed workflow by publishing manually** unless explicitly instructed. Manual publishing bypasses the CI checks that the workflow enforces.

---

## What to Report

At the end of every task, the report must include:

- Every file modified, with a one-line description of what changed and why
- The exact test results — suite name, total count, passed count, failed count, skipped count
- The git commit hash of the final commit
- Whether the GitHub Actions workflow triggered and its status (if a release was made)
- Any findings that were documented but not fixed, with a reference to `AUDIT_FINDINGS.md` if applicable
- Any assumptions made during the task that the developer should be aware of

Do not declare a task complete without all of the above.

---

## General Rules

- Confirm before fix — if you cannot point to the exact file, line, and code that demonstrates an issue, document it and do not touch it
- Test after every commit — the full pipeline must pass after every discrete change
- Do not change behaviour that is not a bug — if something is working as documented, leave it alone
- Do not introduce new logic during refactoring — when splitting or reorganising files, move code verbatim
- Write everything in Australian English — no exceptions
- Keep the changelog up to date — every release, no exceptions
- Follow semantic versioning strictly — when in doubt, go major