#!/usr/bin/env bash
# install.sh — put the branch-link hooks into a repo, without committing them.
#
# See docs/specs/2026-09-06-branch-linked-work-items-design.md §8.
#
#   ./install.sh <repo-path>...
#   ./install.sh --uninstall <repo-path>...
#
# The io repos use husky, so core.hooksPath is .husky/_ and its wrappers call
# .husky/<hook>. Writing .husky/post-checkout there would COMMIT the hook and
# run it on every teammate's machine, so each file is added to
# .git/info/exclude, which is local and never pushed.
#
# Worktrees share the parent repo's hooks, so installing once per repo covers
# all of them — the script resolves the common git dir for exactly that reason.

set -euo pipefail

MARKER='# tardis-branch-link'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$HERE/cli.ts"
HOME_DIR="${HOME}/.tardis-branch-link"
CONFIG="${HOME_DIR}/config.json"

UNINSTALL=0
if [ "${1:-}" = "--uninstall" ]; then
  UNINSTALL=1
  shift
fi

if [ "$#" -eq 0 ]; then
  echo "usage: install.sh [--uninstall] <repo-path>..." >&2
  exit 2
fi

BUN="$(command -v bun || true)"
if [ -z "$BUN" ] && [ "$UNINSTALL" -eq 0 ]; then
  echo "install.sh: bun is not on PATH, and a git hook does not reliably inherit yours." >&2
  exit 1
fi

hook_body() {
  # $1 = hook name. Bake in absolute paths: a git hook's PATH is not your shell's.
  sed -e "s|__BUN__|${BUN}|g" -e "s|__CLI__|${CLI}|g" "$HERE/hooks/$1"
}

# Where hooks actually go, which is not the same in every repo.
#
# The io repos run husky, so core.hooksPath is .husky/_ and its generated
# wrappers call .husky/<hook>. Repos without husky use the default .git/hooks.
# Installing husky-style into a plain repo puts the file somewhere git never
# looks, and the hook silently never fires — so this is detected, not assumed.
#
# Echoes "<dir> <needs-exclude>": .husky lives in the worktree and would be
# committed, .git/hooks never is.
hook_target() {
  local repo="$1" common top hooks_path
  common="$(cd "$repo" && git rev-parse --path-format=absolute --git-common-dir)"
  top="$(dirname "$common")"
  hooks_path="$(git -C "$repo" config --get core.hooksPath || true)"

  case "$hooks_path" in
    '')            echo "$common/hooks 0" ;;
    .husky/_|.husky/_/) echo "$top/.husky 1" ;;
    /*)            echo "$hooks_path 0" ;;
    *)             echo "$top/$hooks_path 0" ;;
  esac
}

install_one() {
  local repo="$1" hook path exclude common dir needs_exclude
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "  skipped: not a git repository" >&2
    return
  fi

  # --git-common-dir, not --git-dir: run inside a worktree, the latter points
  # at .git/worktrees/<name> and the hooks would never fire.
  common="$(cd "$repo" && git rev-parse --path-format=absolute --git-common-dir)"
  read -r dir needs_exclude <<<"$(hook_target "$repo")"

  mkdir -p "$dir"
  exclude="$common/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  touch "$exclude"

  for hook in post-checkout pre-push; do
    path="$dir/$hook"

    if [ -e "$path" ] && ! grep -q "$MARKER" "$path" 2>/dev/null; then
      echo "  refusing to overwrite $path (not ours)" >&2
      continue
    fi

    hook_body "$hook" > "$path"
    chmod +x "$path"

    if [ "$needs_exclude" = "1" ] && ! grep -qxF ".husky/$hook" "$exclude"; then
      printf '.husky/%s\n' "$hook" >> "$exclude"
    fi
    echo "  installed ${path#"$(dirname "$dir")"/}"
  done
}

uninstall_one() {
  local repo="$1" hook path exclude common dir needs_exclude
  common="$(cd "$repo" && git rev-parse --path-format=absolute --git-common-dir)"
  read -r dir needs_exclude <<<"$(hook_target "$repo")"
  exclude="$common/info/exclude"

  for hook in post-checkout pre-push; do
    path="$dir/$hook"
    if [ -e "$path" ] && grep -q "$MARKER" "$path" 2>/dev/null; then
      rm -f "$path"
      echo "  removed .husky/$hook"
    fi
    if [ -f "$exclude" ]; then
      grep -vxF ".husky/$hook" "$exclude" > "$exclude.tmp" || true
      mv "$exclude.tmp" "$exclude"
    fi
  done
}

for repo in "$@"; do
  echo "$repo"
  if [ "$UNINSTALL" -eq 1 ]; then uninstall_one "$repo"; else install_one "$repo"; fi
done

if [ "$UNINSTALL" -eq 1 ]; then
  echo
  echo "Hooks removed. ${HOME_DIR} (config, queue, log) left alone."
  exit 0
fi

if [ ! -f "$CONFIG" ]; then
  echo
  echo "No config at $CONFIG yet."
  # No default host here on purpose: this repository is public, and a personal
  # TARDIS address baked into it would be published with it. TARDIS_URL lets a
  # scripted install skip the prompt without writing the address down.
  url="${TARDIS_URL:-}"
  while [ -z "$url" ]; do
    read -r -p "TARDIS URL (e.g. https://tardis.example.com): " url
  done

  password="${TARDIS_PASSWORD:-}"
  if [ -z "$password" ]; then
    read -r -s -p "TARDIS password: " password
    echo
  fi

  mkdir -p "$HOME_DIR"
  umask 077
  cat > "$CONFIG" <<JSON
{
  "baseUrl": "${url}",
  "password": "${password}",
  "protectedBranches": ["main", "master", "staging", "develop"],
  "maxCommits": 50
}
JSON
  chmod 600 "$CONFIG"
  echo "Wrote $CONFIG (mode 600)."
fi

echo
echo "Done. Branch linking is still OFF until you enable it in the workspace"
echo "plugin settings — an installed hook cannot create anything before that."
