#!/usr/bin/env bash
# Test, build and deploy the live demo to Firebase Hosting.
# Run from Cloud Shell (Firebase CLI already signed in) or any machine with `firebase login` done.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Installing…"; npm ci --no-audit --no-fund --loglevel=error
echo "Testing…"; npm test --silent > /tmp/momo-test.log 2>&1 || { cat /tmp/momo-test.log; exit 1; }
grep -E '(pass|fail) [0-9]+' /tmp/momo-test.log | tail -2 || true
echo "Building…"; npm run build --silent
firebase deploy --only hosting --project where-did-my-momo-go --non-interactive 2>&1 | tail -3
