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

BUN="${TARDIS_BUN:-$(command -v bun || true)}"
CLI="${TARDIS_CLI:-$CLI}"
if [ -z "$BUN" ] && [ "$UNINSTALL" -eq 0 ]; then
  echo "install.sh: bun is not on PATH, and a git hook does not reliably inherit yours." >&2
  exit 1
fi

hook_body() {
  # $1 = hook name, $2 = the shared hooks dir baked into the re-assert.
  # Absolute paths throughout: a git hook's PATH is not your shell's.
  sed -e "s|__BUN__|${BUN}|g" -e "s|__CLI__|${CLI}|g" -e "s|__HOOKSDIR__|${2:-}|g" \
    "$HERE/hooks/$1"
}

# ── Where hooks go, and why a worktree changes the answer ────────────────
#
# husky sets core.hooksPath to the RELATIVE path `.husky/_`. git resolves a
# relative hooksPath against each working tree's OWN root — and `.husky/_` is
# gitignored, generated only where `npm install` ran. So every worktree looks
# for hooks in a directory that does not exist there and runs none, silently.
# Measured on internal-operation-server: 253 worktrees, no hooks, husky's own
# pre-commit included.
#
# The fix is an ABSOLUTE hooksPath. It lives in .git/config, which every
# worktree shares, so all of them — including ones created later — are covered
# with no files in any working tree at all.
#
# A repo with no hooksPath keeps using .git/hooks, which lives in the common
# git dir and is already shared by every worktree. Nothing to fix there.
repo_slug() {
  local common="$1" hash
  hash="$(printf '%s' "$common" | md5sum 2>/dev/null | cut -c1-8)"
  [ -n "$hash" ] || hash="$(printf '%s' "$common" | cksum | cut -d' ' -f1)"
  printf '%s-%s' "$(basename "$(dirname "$common")")" "$hash"
}

install_one() {
  local repo="$1" hook path exclude common top hooks_path shared pin
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "  skipped: not a git repository" >&2
    return
  fi

  # --git-common-dir, not --git-dir: inside a worktree the latter points at
  # .git/worktrees/<name>, and the config we must edit is the shared one.
  common="$(cd "$repo" && git rev-parse --path-format=absolute --git-common-dir)"
  top="$(dirname "$common")"
  hooks_path="$(git -C "$repo" config --get core.hooksPath || true)"
  exclude="$common/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  touch "$exclude"

  if [ -z "$hooks_path" ]; then
    # Plain repo: .git/hooks is already shared by every worktree.
    mkdir -p "$common/hooks"
    for hook in post-checkout pre-push; do
      path="$common/hooks/$hook"
      if [ -e "$path" ] && ! grep -q "$MARKER" "$path" 2>/dev/null; then
        echo "  refusing to overwrite $path (not ours)" >&2
        continue
      fi
      hook_body "$hook" "" > "$path"
      chmod +x "$path"
      echo "  installed .git/hooks/$hook"
    done
    return
  fi

  # ── hooksPath repo (husky) ─────────────────────────────────────────────
  shared="$HOME_DIR/hooks/$(repo_slug "$common")"
  mkdir -p "$shared"

  for hook in post-checkout pre-push; do
    hook_body "$hook" "$shared" > "$shared/$hook"
    chmod +x "$shared/$hook"
  done

  # Stand in for every hook husky owns, so its behaviour is unchanged where it
  # was already working and unchanged where it was not. See hooks/husky-shim.
  if [ -d "$top/.husky" ]; then
    for path in "$top"/.husky/*; do
      hook="$(basename "$path")"
      case "$hook" in
        _|post-checkout|pre-push|'*') continue ;;
      esac
      [ -f "$path" ] || continue
      cp "$HERE/hooks/husky-shim" "$shared/$hook"
      chmod +x "$shared/$hook"
      echo "  shimmed $hook (husky keeps it)"
    done
  fi

  # Remember what to put back, then take over. The included config is written
  # after the repo's own core.hooksPath entry, so a later `husky` prepare can
  # rewrite that entry to `.husky/_` without changing the effective value.
  # This matters most in worktrees: they do not have Husky's generated `_`
  # directory, so a relative hooksPath silently disables every hook there.
  if [ "$hooks_path" != "$shared" ]; then
    git -C "$repo" config tardis.previousHooksPath "$hooks_path"
  fi
  git -C "$repo" config core.hooksPath "$shared"
  pin="$shared/hooks-path.gitconfig"
  git config --file "$pin" core.hooksPath "$shared"
  if ! git -C "$repo" config --local --get-all include.path 2>/dev/null | grep -qxF "$pin"; then
    git -C "$repo" config --local --add include.path "$pin"
  fi
  echo "  core.hooksPath -> $shared"
  echo "  covers $(git -C "$repo" worktree list | wc -l | tr -d ' ') worktrees, and any created later"

  # A copy in .husky/ as well: `npm install` runs husky's `prepare`, which
  # resets core.hooksPath to `.husky/_`. That still fires in the MAIN checkout,
  # and the copy left here is what notices and puts the absolute path back.
  for hook in post-checkout pre-push; do
    path="$top/.husky/$hook"
    if [ -e "$path" ] && ! grep -q "$MARKER" "$path" 2>/dev/null; then
      echo "  refusing to overwrite $path (not ours)" >&2
      continue
    fi
    hook_body "$hook" "$shared" > "$path"
    chmod +x "$path"
    if ! grep -qxF ".husky/$hook" "$exclude"; then
      printf '.husky/%s\n' "$hook" >> "$exclude"
    fi
  done
}

uninstall_one() {
  local repo="$1" hook path exclude common top previous shared pin
  common="$(cd "$repo" && git rev-parse --path-format=absolute --git-common-dir)"
  top="$(dirname "$common")"
  exclude="$common/info/exclude"
  previous="$(git -C "$repo" config --get tardis.previousHooksPath || true)"

  shared="$HOME_DIR/hooks/$(repo_slug "$common")"
  pin="$shared/hooks-path.gitconfig"
  git -C "$repo" config --local --fixed-value --unset-all include.path "$pin" 2>/dev/null || true

  if [ -n "$previous" ]; then
    git -C "$repo" config core.hooksPath "$previous"
    git -C "$repo" config --unset tardis.previousHooksPath 2>/dev/null || true
    echo "  core.hooksPath restored to $previous"
  fi

  rm -rf "$shared"

  for hook in post-checkout pre-push; do
    for path in "$top/.husky/$hook" "$common/hooks/$hook"; do
      if [ -e "$path" ] && grep -q "$MARKER" "$path" 2>/dev/null; then
        rm -f "$path"
        echo "  removed ${path#"$top"/}"
      fi
    done
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
  password="${TARDIS_PASSWORD:-}"

  # Only prompt if there is a terminal to prompt on. Without this guard a
  # non-interactive run (CI, an agent, anything with stdin closed) spins
  # forever: `read` returns EOF immediately, the variable stays empty, and the
  # loop never ends.
  if [ -t 0 ]; then
    while [ -z "$url" ]; do
      read -r -p "TARDIS URL (e.g. https://tardis.example.com): " url || break
    done
    if [ -z "$password" ]; then
      read -r -s -p "TARDIS password: " password || true
      echo
    fi
  fi

  if [ -z "$url" ] || [ -z "$password" ]; then
    echo
    echo "Hooks are installed, but there is no config yet and nothing to ask on."
    echo "The hooks stay dormant until $CONFIG exists. Create it with:"
    echo
    echo "  mkdir -p '$HOME_DIR' && (umask 077 && cat > '$CONFIG' <<'JSON'"
    echo "  {"
    echo '    "baseUrl": "https://your-tardis.example.com",'
    echo '    "password": "your-tardis-password",'
    echo '    "protectedBranches": ["main", "master", "staging", "develop"],'
    echo '    "maxCommits": 50'
    echo "  }"
    echo "  JSON"
    echo "  )"
    echo
    exit 0
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
