---
name: review-pi-gui-fork-work
description: "Review the uncommitted fork work described in HANDOFF.md: the ja locale, the identity guard, and the package.json wiring. Use when asked to inspect, audit, or verify that handoff work before it is committed."
---

# Review the fork handoff work

You are reviewing **uncommitted** work by a previous agent, described in
the [review status](../../../docs/development/fork-review-status.md), linked from
[`HANDOFF.md`](../../../HANDOFF.md). The author of that handoff is not available to answer
questions, so verify everything against the repository, not against the prose.

The original request specified this reading order: `../AGENT.md`, `HANDOFF.md`,
this skill, then the root [`AGENTS.md`](../../../AGENTS.md) and
[`apps/desktop/src/i18n/AGENTS.md`](../../../apps/desktop/src/i18n/AGENTS.md).
Read the first two before using this skill. Follow the handoff links for the recorded
results. The current user request and actual worktree take precedence.

## Scope

Start with the full working tree. Review every changed path that belongs to the fork
handoff, including supporting tests, verification scripts, and rule files. Do not
assume the original six code paths are still the whole diff.

```bash
git -C <repo> status --porcelain
git -C <repo> diff --stat
git -C <repo> diff --check
```

- `apps/desktop/src/i18n/messages/ja.ts` (new)
- `apps/desktop/src/i18n/catalog.ts` (locale registration)
- `scripts/check-identity.mjs` (new)
- `scripts/check-identity.test.mjs` (new)
- `package.json` (`check`, `check:identity`, `test:guards`)
- `.gitignore` (fork-local build identity)

The original request called these "seven files" but listed the six paths above.
Record the actual worktree separately from this starting inventory.

Do not start the update-button or auto-update work. That is explicitly unimplemented.

## Verify, do not assume

Compare the requested paths, base, and relevant verification conditions against the
[recorded scope](../../../docs/development/fork-review-status.md#確定した取り込み単位).
Reuse matching results, including the confirmed 13-file scope. Run affected checks
when inputs or verification conditions changed. Label reused and newly run evidence.

For a new verification batch, use the repository's pinned pnpm and run:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Use the existing installation when it matches the lockfile. If pnpm is unavailable
on Windows, use the [repo-local pnpm instructions](../../../docs/development/claude-handoff.md#windows-での検証).
`pnpm check` includes the identity guard, its unit tests, lint, type checking, and
the other baseline checks. Run separate stages when diagnosing a failure or
checking a relevant stage the baseline did not reach. Run the identity guard on
the final worktree before sharing as required by `AGENTS.md`. Run
`pnpm i18n:check ja` when the locale changes and verify changed GUI copy in real
Electron. [Implementation workflow](../../../docs/development/workflows.md#実装ループ)

## Review the ja catalog properly

The original handoff described 239 Japanese keys; later edits can change that
count. Compare the actual English and Japanese catalogs rather than accepting
either number from a handoff.

`node scripts/new-locale.mjs --check ja` compares a value against the English copy and only
reports exact equality (`scripts/new-locale.mjs:84`). It therefore **cannot** prove the values
are Japanese. Check by reading:

1. Every key in `messages/en.ts` exists in `messages/ja.ts`, with no extras.
2. Every `{placeholder}` in a ja value matches the same key's en placeholders. Regex over both
   files is enough; report any mismatch with the key name.
3. Read every value as UI copy. Flag mistranslations, mixed polite/plain form in one
   surface, and text that would break layout (much longer than the English).
4. Inspect the fragment keys that split a sentence around inline markup:
   `ui.includeThe`, `ui.suffixOllama`, `ui.vllm`,
   `ui.requiredByTheStorageFormatForVLLMStartedWith`,
   `ui.enterThatKeyForOllamaOrOtherServersWithoutAuthLeaveBlank`. Read the consuming JSX in
   `apps/desktop/src/features/settings/settings-custom-endpoints-section.tsx` and confirm the
   assembled sentence reads correctly in Japanese, including the final punctuation.

Use the [current translation coverage](../../../apps/desktop/src/i18n/AGENTS.md#coverage)
and the scope of the requested diff when deciding which untranslated surfaces are in scope.

## Attack the identity guard

`scripts/check-identity.mjs` is a security control, so review it as one.
Use the coverage recorded in the review status as a starting point. Probe for gaps:

- Write throwaway fixtures under a scratch directory (never inside the repo) and call
  `checkIdentity(root, { files })` directly to test shapes the regression tests do not cover.
- Consider: Japanese names and addresses, phone numbers, internal hostnames, Git author and
  committer lines in commit messages, values inside `.env`-shaped files, secrets split across
  lines, base64 blobs, and credentials in URLs (account and secret embedded before the host).
- Judge whether fixture-only exceptions can hide a real value. Check `user`,
  `me`, `you`, `agent`, and `demo` as home names. Reserved example domains
  accept arbitrary subdomains; generic home names should be allowed only in
  designated fixture files.
- Confirm the guard reads tracked and non-ignored untracked files, including new source before commit.
- Confirm a binary file with a text extension fails closed instead of making
  a NUL byte hide text.

The upstream packaging contact is classified `upstream` (reported, not failing)
because `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/verify-release-config.mjs`
and `apps/desktop/scripts/verify-linux-release.sh` assert that exact string. Check that
reasoning still holds, and say what breaks when a fork replaces the maintainer.

## Judge the package.json wiring

- Confirm `check:identity` runs before slower checks in `check`.
- Is adding the test to `test:guards` correct, and is the invocation style consistent with the
  neighbouring entries?
- Does `.gitignore` cover exactly the fork-local artifacts, with no over-broad pattern that
  would hide real source?

## Report

The original review request asked for a Japanese report with these seven sections
and `path:line` evidence. Later reporting directions in
[the development workflow](../../../docs/development/workflows.md#作業全般の基準) govern current work
unless the user asks again for the original format.

1. **結論** — ship as-is / fix first / reject, in one or two sentences.
2. **実行した検証** — each command, its real exit status, and the observed output. Separate
   what you ran from what you merely read.
3. **差分レビュー** — findings per file. Distinguish defect / risk / nit.
4. **ガードレールの評価** — concrete bypasses or false positives you demonstrated, with the
   fixture that produced them.
5. **HANDOFF.md の正確性** — every statement in the handoff that is wrong, stale, or
   unverifiable.
6. **未解決の論点への回答** — answer the original four questions if their text is
   available; the current `HANDOFF.md` no longer contains that original §6, so do
   not invent its wording or claim it was verified.
7. **推奨する次の作業** — ordered, with the reason for the order.

The original request was review-only. Follow the latest user instruction and
`HANDOFF.md` for the current scope.
Do not commit or push. Do not read real personal data, auth files, API keys, tokens,
or user session history. Scratch fixtures go in the session scratchpad directory
and are deleted afterwards. If a check cannot run for an environmental reason,
say so plainly instead of implying it passed.
