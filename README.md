# Fractal AI Builder

AI-powered preset builder for Fractal Audio FM3-Edit, Axe-Edit III, and AM4.

Uses Claude's Computer Use API to see your screen and control the Fractal Edit software automatically based on natural language instructions.

## How It Works

1. You describe what you want: *"Build a high-gain metal preset with a Friedman BE-100, Tube Screamer, and stereo delay"*
2. The app takes a screenshot of your screen
3. Claude's AI analyzes the screenshot and decides what to click/type
4. The app executes the action (click, type, scroll, etc.)
5. Repeat until the task is done

## Requirements

- macOS 12+
- Anthropic API key (get one at [platform.anthropic.com](https://platform.anthropic.com))
- FM3-Edit, Axe-Edit III, or AM4 Edit installed and connected to your device

## Download

See [Releases](../../releases) for the latest `.dmg` files.

- **Apple Silicon (M1–M5):** Download the `arm64.dmg`
- **Intel Mac:** Download the `x64.dmg`

## First Time Setup

1. Download and install the app
2. Right-click → Open (bypasses Gatekeeper on first launch)
3. Grant **Screen Recording** permission in System Settings → Privacy & Security
4. Enter your Anthropic API key in the Settings panel
5. Open FM3-Edit (or your Fractal app of choice)
6. Type your instructions and click **Start AI Session**

## Cost

Powered by Claude Sonnet 4.5 by default (~$0.50–1.00 per preset-building session).
You can switch to Haiku 4.5 for even cheaper runs (~$0.10–0.25/session).

## Built By

Justin Newbold — [newbold.cloud](https://newbold.cloud)
