#!/bin/sh
set -eu
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
display_number="${DISPLAY#:}"
rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}"
rm -f "$HOME/.config/Grok Bot/SingletonLock" "$HOME/.config/Grok Bot/SingletonSocket" "$HOME/.config/Grok Bot/SingletonCookie"
Xvfb "$DISPLAY" -screen 0 1280x800x24 &
exec dbus-run-session -- grok-bot --no-sandbox --disable-gpu
