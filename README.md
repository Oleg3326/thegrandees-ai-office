# AI Office (fork)

A pixel-art live wallpaper for [Wallpaper Engine](https://www.wallpaperengine.io/) (Windows) that shows what the AI tools on your PC are doing. Open Claude Code, Codex, ChatGPT, the Claude desktop app or Ollama, and a bot arrives in its own car, sits at a desk and starts typing. Close the program, and the bot walks out to the curb and rides home.

This is a personal fork of [AlexanderGrandees/thegrandees-ai-office](https://github.com/AlexanderGrandees/thegrandees-ai-office) (MIT). The pixel art, scene, weather and sounds are the original author's work, credited in `LICENSE`. Windows only, for entertainment only.

![Autumn night](docs/screenshots/autumn-night.png)

## What this fork changes

- **Russian interface:** speech bubbles, dialogues, statuses and buttons (no "ё" in the bubbles: the pixel font may not have it).
- **Region:** the clock, sunrise/sunset and the "Auto" season follow the chosen city. Pick it with the button in the panel; Moscow by default; the choice is stored in the browser (`office-region`). The list is `REGIONS` in `index.html`.
- **Claude Code subagents** (`SubagentStart` / `SubagentStop` hooks) appear as separate bots in yellow hard hats. They walk in from the street, the name tag shows the type ("EXPLORE", "PLAN"), and the panel shows "Claude Code › Explore". At most 4 subagents per session.
- **Claude Code context:** a bar under the name tag (green up to 60%, yellow up to 85%, then flashing red), the percentage in the panel, and a pile of papers by the desk (a sheet flies around at 90%).
- **Tool errors:** when a tool fails (`PostToolUseFailure`), the bot's eyes and monitor turn red for 8 seconds.
- **Smoke break:** when Claude Code's context is above 60% and it is idle, the bot steps outside, stands left of the door and smokes for 20 to 35 seconds, swearing. A new task sends it straight back to its desk. At most one break every 2 to 3 minutes. Claude only, for now.
- **Compact name tags** over the bots, and the panel shows just "Claude Code" without the folder name.
- **Removed:** the rocket, the "busification" and their scenes and sounds.
- **Housekeeping:** the author's auto-update is off (it would overwrite local edits; set `OFFICE_ALLOW_UPDATE=1` to bring it back) and the author's install counter is not pinged.

## What happens in the office

| Agent | Colour | How the office knows what it is doing |
|---|---|---|
| Claude Code | orange | hooks: working, waiting for you, done |
| Codex | white and black | hooks (approve them once in Codex with `/hooks`) |
| ChatGPT (desktop app) | green | no hooks, "working" is guessed from CPU load |
| Ollama | llama in headphones | sits in the office while Ollama is open |
| Claude app, Gemini, Grok, DeepSeek and others | brand colours | app is open; "working" by CPU load |

- **Working:** the bot types, code runs on its monitor, an icon shows the tool in use.
- **Waiting for you** (permission prompt or question): it waves, and the monitor blinks a yellow "!".
- **Idle for 40 seconds:** it relaxes on the sofa, at the arcade or in the kitchen. Every few minutes a working bot fetches coffee or tea or sits at the cafe table.
- **Murchyk the cat**, the cars (Tesla, limousine, taxi), bot dialogues, desk lamps, seasons, weather, sound and day/night by the real sun are unchanged from the original.

## Install

You need [Wallpaper Engine](https://store.steampowered.com/app/431960/Wallpaper_Engine/). Clone or download this repo and double-click `install-windows.cmd` (from PowerShell: `$env:TGTI_SOURCE = (Get-Location).Path; powershell -ExecutionPolicy Bypass -File .\windows\install.ps1`). No admin rights needed. The installer:

- copies the office to `%LOCALAPPDATA%\TGTI-AI-Office` (a separate copy: run the installer again after editing the repo);
- uses your Node.js 18+ or downloads a private copy into that folder;
- adds the hooks to `~/.claude/settings.json` and to Codex (backups are kept as `*.bak-…`);
- adds the wallpaper to Wallpaper Engine: open *Installed* and pick "AI Office";
- adds a hidden task that starts the server every minute while Wallpaper Engine is open.

Restart Claude Code and Codex afterwards (hooks are read at startup). In Codex, type `/hooks` once and approve them.

## Testing without any AI running

Open `index.html` in a browser, append a mode to the address and press Ctrl+F5:

| Address | What it shows |
|---|---|
| `index.html#demo` | the office with fake bots, subagents, an error and 82% context |
| `index.html#demo-smoke-fast` | the smoke break: an idle Claude at 82% context goes out to smoke after about 30 seconds |
| `index.html#demo-winter-night-storm` | winter, night, thunderstorm (also `-summer`, `-fog`, `-snow` and so on) |
| `index.html#demo-brief` | the briefing |
| `index.html#nohud` | no panel |

Through the server: in `%LOCALAPPDATA%\TGTI-AI-Office` run `node test-agent.mjs TEST`. A bot walks in, starts two subagents, hits an error and reaches 97% context.

The "Demo" button in the panel adds fake bots when no real ones are around.

## Settings

- **Season, weather, sound, region:** the buttons in the panel, or the wallpaper properties in Wallpaper Engine.
- **Context window size** is guessed: more than 200k tokens in context counts as a 1M window. Set your own with the server environment variable `OFFICE_CTX_MAX=number`.

## Privacy

- The hook sends the session id, folder name, event and tool names, a process id and a short caption of the action (a file name, the first word of a command, a site's domain, the first 6 characters of your prompt). Full prompts, commands and code are never sent, and nothing leaves your PC. The context size comes from the tail of the transcript file; only one number leaves the hook.
- The server listens on `127.0.0.1:7777` only.
- The hook always exits successfully, so it never breaks Claude Code or Codex, even when the server is off.
- The server reads the process list every 4 seconds (PowerShell).

## Remove

`powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\TGTI-AI-Office\uninstall.ps1"` removes the hooks, the autostart, the wallpaper and the private Node.js copy.

## Limitations

- Only programs installed on the computer are visible. ChatGPT or Claude in a browser tab and cloud sessions do not show up.
- Context is available for Claude Code only (the other tools have no hooks with that data). Tokens per second and rate limits are not exposed by hooks.
- Codex has no subagents.
- The `macos/` folder is left over from the original and is untested in this fork.

## Files

| File | What it does |
|---|---|
| `index.html` | the wallpaper: a 384×216 scene scaled up 2× without smoothing |
| `office-server.mjs` | local server: processes, hook events, `/state` |
| `hook.mjs` | the hook called by Claude Code and Codex |
| `install-hooks.mjs` | adds or removes the hooks |
| `windows/` | installer, uninstaller, `watch.vbs` |
| `test-agent.mjs` | fake agent for testing |
| `fonts/` | [Tiny5](https://github.com/Gissio/font_tiny5) pixel font (SIL Open Font License) |

## License

Code: [MIT](LICENSE). Font: SIL OFL 1.1 (`fonts/OFL.txt`). Original by [TheGrandees](https://github.com/AlexanderGrandees).
