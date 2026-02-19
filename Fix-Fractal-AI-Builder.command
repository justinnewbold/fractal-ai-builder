#!/bin/bash

# Fractal AI Builder — macOS Quarantine Fix
# Double-click this file to allow the app to open.
# This removes the "damaged" restriction that macOS places on downloaded apps.

APP_PATH="/Applications/Fractal AI Builder.app"

echo ""
echo "======================================"
echo "  Fractal AI Builder — Quarantine Fix"
echo "======================================"
echo ""

# Check if app exists in Applications
if [ ! -d "$APP_PATH" ]; then
  echo "⚠️  Could not find 'Fractal AI Builder' in your Applications folder."
  echo ""
  echo "Please make sure you've dragged the app from the DMG into Applications first,"
  echo "then run this script again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

echo "Found: $APP_PATH"
echo ""
echo "Removing macOS quarantine restriction..."
echo "(You may be prompted for your Mac password)"
echo ""

# Remove quarantine attribute
xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
  echo "✅ Done! Fractal AI Builder is now unlocked."
  echo ""
  echo "You can now open it normally from your Applications folder."
  echo ""
  
  # Open the app
  read -p "Press Enter to launch Fractal AI Builder now, or Cmd+C to cancel..."
  open "$APP_PATH"
else
  echo "❌ Something went wrong. Try running this script again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi
