#!/bin/bash
# Run ON the Raspberry Pi (deploy.sh calls it). Safe to re-run.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ME="$(id -un)"

[ -f "$APP/config.json" ]  || cp "$APP/config.example.json"  "$APP/config.json"
[ -f "$APP/calendar.txt" ] || cp "$APP/calendar.example.txt" "$APP/calendar.txt"
chmod +x "$APP/deploy/kiosk.sh"

# Backend service (weather + TTC proxy, backlight schedule)
sed -e "s#__USER__#$ME#g" -e "s#__APP__#$APP#g" "$APP/deploy/morning-pi.service" \
  | sudo tee /etc/systemd/system/morning-pi.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable morning-pi.service >/dev/null
sudo systemctl restart morning-pi.service

# Let the service set screen brightness without root
sudo install -m 0644 "$APP/deploy/99-morning-pi-backlight.rules" /etc/udev/rules.d/
sudo chmod 0666 /sys/class/backlight/*/brightness 2>/dev/null || true

# Kiosk: replace the desktop session's autostart with the full-screen display
mkdir -p "$HOME/.config/labwc"
if [ -f "$HOME/.config/labwc/autostart" ] && ! grep -q morning-pi "$HOME/.config/labwc/autostart"; then
  cp "$HOME/.config/labwc/autostart" "$HOME/.config/labwc/autostart.before-morning-pi"
fi
echo "/usr/bin/lwrespawn $APP/deploy/kiosk.sh &" > "$HOME/.config/labwc/autostart"

# Never blank the screen (the service handles night-time dimming)
sudo raspi-config nonint do_blanking 1 >/dev/null 2>&1 || true

echo "Morning Pi installed. Service: $(systemctl is-active morning-pi.service)"
