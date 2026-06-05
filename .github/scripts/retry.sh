#!/usr/bin/env bash
# Generic retry wrapper with exponential backoff for shell commands.
#
# Used by .github/workflows/release.yml to make individual network-bound
# steps (npm view, gh release create, git push tag, ...) tolerant to
# transient infrastructure failures like the GitHub API 504 Gateway
# Timeout that took down a single publish-matrix job in run #27004533534.
#
# Usage (sourced):
#   source .github/scripts/retry.sh
#   retry [MAX_ATTEMPTS] [INITIAL_BACKOFF_S] -- command [args...]
#
# Or via env vars:
#   MAX_ATTEMPTS=5 INITIAL_BACKOFF=2 retry -- gh release create ...
#
# Or as a standalone script:
#   bash .github/scripts/retry.sh -- gh release view "$TAG"
#   MAX_ATTEMPTS=3 bash .github/scripts/retry.sh -- npm view "$PKG@$VER"
#
# Defaults: MAX_ATTEMPTS=5, INITIAL_BACKOFF=2.
# Wait sequence with defaults: 2s, 4s, 8s, 16s (between attempts 1-2,
# 2-3, 3-4, 4-5). Worst-case extra wall-time on full failure: 30s.
#
# Behaviour:
#   - Runs the command. On exit 0, returns 0 immediately.
#   - On non-zero exit: emits a `::warning::` annotation, sleeps the
#     current backoff, doubles the backoff, increments the attempt
#     counter and retries.
#   - On the final attempt: emits a `::error::` annotation and returns
#     the exit code of the last attempt (so `set -e` callers behave).
#
# Use only on commands whose failures may be transient (network 5xx,
# rate limits, DNS hiccups). Do NOT wrap commands whose failures are
# typically deterministic (build/test/lint, npm publish 404, etc.) —
# retries there mask real bugs and waste CI minutes.

retry() {
  local max="${MAX_ATTEMPTS:-5}"
  local backoff="${INITIAL_BACKOFF:-2}"

  # Optional positional overrides: `retry 3 1 -- cmd ...`
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then max="$1"; shift; fi
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then backoff="$1"; shift; fi
  if [[ "${1:-}" == "--" ]]; then shift; fi

  if [[ $# -eq 0 ]]; then
    echo "retry: missing command" >&2
    return 2
  fi
  if [[ "$max" -lt 1 ]]; then
    echo "retry: MAX_ATTEMPTS must be >= 1 (got $max)" >&2
    return 2
  fi

  local attempt=1
  local code=0
  while true; do
    # `&& return 0` short-circuits on success and preserves $? from "$@"
    # on failure (a plain `if "$@"; then return; fi` would clobber $?).
    "$@" && return 0
    code=$?
    if [[ $attempt -ge $max ]]; then
      echo "::error::Command failed after $max attempts (exit $code): $*" >&2
      return "$code"
    fi
    echo "::warning::Attempt $attempt/$max failed (exit $code); retrying in ${backoff}s: $*" >&2
    sleep "$backoff"
    backoff=$(( backoff * 2 ))
    attempt=$(( attempt + 1 ))
  done
}

# Allow direct invocation:
#   bash .github/scripts/retry.sh -- gh release view foo
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  retry "$@"
fi
