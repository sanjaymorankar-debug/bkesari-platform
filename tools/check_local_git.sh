#!/usr/bin/env bash
# Show how your local clones differ from GitHub.
#
# For each repository it reports:
#   - uncommitted files and stashes
#   - local branches with commits you have not pushed (ahead) or not pulled (behind)
#   - local branches that were never pushed
#   - GitHub branches whose work is not merged into the default branch
#
# Usage:
#   tools/check_local_git.sh                         # the three repos next to this one
#   tools/check_local_git.sh ~/Projects/ATIP-DEV ... # any clones you name
#   tools/check_local_git.sh --csv status.csv ...    # also write a CSV (opens in Excel)
#   tools/check_local_git.sh --no-fetch ...          # skip "git fetch" (offline)
#
# Written for macOS's built-in bash 3.2: no associative arrays, no mapfile.
set -uo pipefail

CSV=""
FETCH=1
REPOS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --csv) CSV="$2"; shift 2 ;;
        --no-fetch) FETCH=0; shift ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) REPOS+=("$1"); shift ;;
    esac
done
if [[ ${#REPOS[@]} -eq 0 ]]; then
    PARENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    for name in ATIP-DEV bkesari bkesari-platform; do
        [[ -d "$PARENT/$name/.git" ]] && REPOS+=("$PARENT/$name")
    done
fi
if [[ ${#REPOS[@]} -eq 0 ]]; then
    echo "No repositories found. Pass their folders, e.g. $0 ~/Projects/ATIP-DEV" >&2
    exit 1
fi

[[ -n "$CSV" ]] && echo "repo,kind,branch,ahead,behind,status" > "$CSV"
csv() { [[ -n "$CSV" ]] && echo "$1,$2,$3,$4,$5,\"$6\"" >> "$CSV"; return 0; }

for dir in "${REPOS[@]}"; do
    if ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
        echo "!! $dir is not a git repository" >&2
        continue
    fi
    repo="$(basename "$(git -C "$dir" rev-parse --show-toplevel)")"
    echo
    echo "================ $repo  ($dir)"
    if [[ $FETCH -eq 1 ]]; then
        git -C "$dir" fetch --prune --quiet origin || echo "   (fetch failed - showing the last known GitHub state)"
    fi

    default="$(git -C "$dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
    if [[ -z "$default" ]]; then
        for cand in origin/main origin/master; do
            git -C "$dir" rev-parse --verify --quiet "$cand" >/dev/null && { default="$cand"; break; }
        done
    fi
    echo "   GitHub default branch : ${default:-unknown}"
    echo "   Checked out           : $(git -C "$dir" branch --show-current 2>/dev/null || echo detached)"

    dirty="$(git -C "$dir" status --porcelain | wc -l | tr -d ' ')"
    stashes="$(git -C "$dir" stash list | wc -l | tr -d ' ')"
    echo "   Uncommitted files     : $dirty"
    echo "   Stashes               : $stashes"
    csv "$repo" worktree "$(git -C "$dir" branch --show-current)" "" "" "$dirty uncommitted file(s), $stashes stash(es)"

    echo "   Local branches:"
    for b in $(git -C "$dir" for-each-ref --format='%(refname:short)' refs/heads/); do
        up="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name "$b@{upstream}" 2>/dev/null || true)"
        if [[ -z "$up" ]] || ! git -C "$dir" rev-parse --verify --quiet "$up" >/dev/null; then
            n="$(git -C "$dir" rev-list --count "$b" --not --remotes)"
            if [[ "$n" -gt 0 ]]; then
                status="LOCAL ONLY - $n commit(s) not on GitHub"
            else
                status="no upstream, but every commit is on GitHub"
            fi
            printf "     %-40s %s\n" "$b" "$status"
            csv "$repo" local "$b" "$n" "" "$status"
            continue
        fi
        set -- $(git -C "$dir" rev-list --left-right --count "$b...$up")
        ahead="$1"; behind="$2"
        if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then
            status="in sync with $up"
        elif [[ "$ahead" -gt 0 && "$behind" -gt 0 ]]; then
            status="DIVERGED: $ahead to push, $behind to pull ($up)"
        elif [[ "$ahead" -gt 0 ]]; then
            status="UNPUSHED: $ahead commit(s) to push to $up"
        else
            status="behind: $behind commit(s) to pull from $up"
        fi
        printf "     %-40s %s\n" "$b" "$status"
        csv "$repo" local "$b" "$ahead" "$behind" "$status"
    done

    [[ -z "$default" ]] && continue
    echo "   GitHub branches not merged into $default:"
    found=0
    for rb in $(git -C "$dir" for-each-ref --format='%(refname:short)' refs/remotes/origin/); do
        [[ "$rb" == "origin/HEAD" || "$rb" == "origin" || "$rb" == "$default" ]] && continue
        ahead="$(git -C "$dir" rev-list --count "$default..$rb")"
        [[ "$ahead" -eq 0 ]] && continue
        # git cherry marks a commit "+" when no equivalent change is in the default branch
        unique="$(git -C "$dir" cherry "$default" "$rb" | grep -c '^+' || true)"
        [[ "$unique" -eq 0 ]] && continue
        found=1
        printf "     %-40s %s commit(s) not merged  (last: %s)\n" "${rb#origin/}" "$unique" \
            "$(git -C "$dir" log -1 --format='%cs %s' "$rb" | cut -c1-70)"
        csv "$repo" github "${rb#origin/}" "$unique" "" "not merged into ${default#origin/}"
    done
    [[ $found -eq 0 ]] && echo "     (none)"
done
echo
[[ -n "$CSV" ]] && echo "CSV written to $CSV"
exit 0
