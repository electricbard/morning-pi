#!/bin/bash
# Copy this folder (including your private config.json and calendar.txt) to the Pi and install.
# Usage: MORNING_PI_HOST=user@morning-pi.local ./deploy.sh
set -euo pipefail
HOST="${MORNING_PI_HOST:?Set MORNING_PI_HOST, e.g. MORNING_PI_HOST=pi@morning-pi.local ./deploy.sh}"
cd "$(dirname "$0")"
rsync -az --delete --exclude .git --exclude .DS_Store --exclude __pycache__ --exclude candidates --exclude cad ./ "$HOST:morning-pi/"
ssh "$HOST" 'bash ~/morning-pi/deploy/install.sh'
