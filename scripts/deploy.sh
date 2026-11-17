#!/usr/bin/env bash
# Test, build and deploy the live demo to Firebase Hosting.
# Run from Cloud Shell (Firebase CLI already signed in) or any machine with `firebase login` done.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --no-audit --no-fund --silent
npm test --silent 2>&1 | grep -E '^# (pass|fail)'
npm run build --silent
firebase deploy --only hosting --project where-did-my-momo-go --non-interactive 2>&1 | tail -3
