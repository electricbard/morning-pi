#!/bin/sh
# Launched by labwc at login (via lwrespawn, which restarts it if it ever exits).
URL="http://127.0.0.1:8080/"
for i in $(seq 1 60); do
  curl -fs "${URL}api/health" >/dev/null 2>&1 && break
  sleep 1
done
exec chromium \
  --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --no-first-run --password-store=basic --check-for-update-interval=31536000 \
  --disable-features=Translate --overscroll-history-navigation=0 --disable-pinch \
  --ozone-platform=wayland \
  "$URL"
