#!/bin/sh
# Pull origin/main into /srv/waitlist; on a move, stamp /run/commit and ask the api to
# reload. REPO_URL carries the branch, LOCAL/DISTANT nothing else; the api token pokes it.
set -eu
REPO_URL=${REPO_URL:?repo url}
ADMIN_TOKEN=${ADMIN_TOKEN:?admin token}
API_URL=${API_URL:-http://api:4001}

git init -q 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

previous=""
while :; do
  if git fetch --quiet origin main 2>/dev/null; then
    next=$(git rev-parse origin/main)
    if [ "$next" != "$previous" ]; then
      git reset --hard -q origin/main
      echo "$next" > /run/commit
      previous=$next
      echo "sync: $next"
      curl -fsS "$API_URL/admin/reload?token=$ADMIN_TOKEN" >/dev/null 2>&1 \
        || echo "sync: api reload poked (it or its npm boot may still be down; next pass retries)"
    else
      echo "sync: no change"
    fi
  else
    echo "sync: fetch failed"
  fi
  sleep "${SYNC_INTERVAL:-5}"
done
