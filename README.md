# TheGrandees AI Office

English · [Русский](README.ru.md)

A pixel-art live wallpaper that turns the AI tools running on your computer into little office workers. On Windows it runs in [Wallpaper Engine](https://www.wallpaperengine.io/); on a Mac it is a small app that becomes your desktop wallpaper and also drops down from the MacBook notch. Open Claude Code, Codex, ChatGPT, the Claude desktop app or a model in Ollama, and a bot arrives in its own car, sits at a desk and starts typing. Close the program, and it walks out to the curb and rides home.

**Steam Workshop:** [subscribe to TheGrandees AI Office](https://steamcommunity.com/sharedfiles/filedetails/?id=3823996127). To see your own AI tools in the office, run the installer below once.

**For entertainment only.** This is a pixel-art desktop toy, not a monitoring or productivity tool.

![Autumn night](docs/screenshots/autumn-night.png)

| | |
|---|---|
| ![Summer day](docs/screenshots/summer-day.png) | ![Winter night with snow](docs/screenshots/winter-night.png) |
| ![Winter day](docs/screenshots/winter-day.png) | ![Spring evening](docs/screenshots/spring-dusk.png) |

## What happens in the office

| Agent | Colour | How the office knows what it is doing |
|---|---|---|
| Claude Code | orange | hooks: working, waiting for you, done |
| Codex | white and black | hooks (approve them once in Codex with `/hooks`) |
| ChatGPT (desktop app) | green | no hooks, "working" is guessed from CPU load |
| Ollama | llama in headphones | sits in the office while Ollama is open; "working" while the model answers |
| Gemini, Grok, DeepSeek, Qwen, Mistral, Perplexity, Copilot | brand colours | desktop app or CLI is open; "working" by CPU load |
| Claude (desktop app) | light orange | same, from CPU load |

- **Working:** the bot types, code runs on its monitor, and an icon shows the tool it uses (terminal, pencil, magnifier).
- **Waiting for you** (a permission prompt or a question): it waves, and its monitor blinks a yellow "!".
- **Idle for 40 seconds:** it goes to relax on the sofa, the bean bags, the arcade machine or in the kitchen.
- **Coffee breaks:** every few minutes a working bot walks to the coffee machine or the water cooler.
- **Speech bubbles** in Ukrainian ("Привіт!", "Правлю файл", "Кава!"), never more than two at once.
- **Murchyk the cat** sleeps on his mat, wanders around, sits next to a bot working at its desk, curls up purring beside bots on the sofa and begs at the coffee machine, where a bot sometimes tosses him a treat. Bots answer him, and little hearts float up.
- **Own cars:** Claude arrives and leaves in a white Tesla, ChatGPT in a black GRANDE limousine about one time in four (a taxi otherwise), Codex by taxi. Bots get out one by one, a leaving bot waits at the curb, and other cars queue behind a stopped one.
- **The cat greets** every bot that arrives at the door and sees off those who leave.
- **Coffee table:** now and then two bots sit at the round kitchen table with coffee and chocolate and chat while the chocolate bar shrinks.
- **What they are doing:** the panel and speech bubbles show the real current action, for example "править JournalPage.tsx", "термінал: git push" or "думає над «Привіт…»". ChatGPT and the Claude app have no hooks, so they show "пише відповідь у чаті" while busy.
- **Dialogues:** bots talk to each other, partly about their real work (GPT asks Claude which file it is editing, someone notices a `git push`, Codex asks GPT for a report). GPT shows Claude a drawing, Claude shows GPT how to write code, Codex bosses GPT around, plus small talk about coffee, lunch and the market.
- **Desk lamps** switch on when a bot sits down and off when it leaves. At night the room stays warmly lit and the lamps glow.
- **Seasons:** spring blossom and flowers, summer greenery, autumn leaves, winter snow with a Christmas tree and a snowman. Auto mode picks the season by month.
- **Weather** changes by itself every 6 to 15 minutes, with odds that fit the season: clear, rain (puddles, ripples, wet road reflecting the lamps and the neon sign), thunderstorm with lightning, snow, fog drifting over the street, strong wind with flying leaves. Bots comment on it.
- **Sound,** all synthesised in the browser with no audio files: rain, wind, thunder, city hum and passing cars, keyboards of working bots, lamp clicks, the taxi horn and door, the coffee machine, little voice blips with each speech bubble, a soft chime when a bot waits for you, birds on clear spring and summer days, crickets on warm nights. It goes quiet when Wallpaper Engine pauses the wallpaper.
- **Night:** street lamps, fairy lights on the hedge, fireflies over the grass on warm nights, car headlights.
- **Wind behind the building:** light streaks pass behind the office, and the backlight, neon sign and street lamps flicker with the gusts.
- **Day and night** follow the real sunrise and sunset in Kyiv for today's date, so winter evenings get dark earlier. The wall clock shows Kyiv time.
- **Panel** in the top right lists every agent and what it is doing, and today's sunrise and sunset. At the bottom are two buttons: season (Auto → Spring → Summer → Autumn → Winter) and weather (Auto → Clear → Rain → Storm → Snow → Fog → Wind).
- **Detail:** the scene is drawn at 768×432 and scaled up without smoothing, so it stays crisp pixel art at any screen size.

## Install

The installer downloads one tiny empty file from this repo's releases on the first install, so the author can count installs. Nothing about you or your computer is sent.

### Windows 10 / 11

You need [Wallpaper Engine](https://store.steampowered.com/app/431960/Wallpaper_Engine/). Everything else is installed for you. Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/windows/install.ps1 | iex
```

Or download `TGTI-AI-Office-windows.zip` from [Releases](https://github.com/AlexanderGrandees/thegrandees-ai-office/releases/tag/windows-latest), unzip it and double-click `install-windows.cmd`.

The installer needs no admin rights. It:
- copies the office into `%LOCALAPPDATA%\TGTI-AI-Office`;
- uses your Node.js if you have version 18 or newer, otherwise downloads a private copy of Node.js LTS into that folder (your PATH is not changed);
- adds the hooks for Claude Code and Codex (backups of the settings files are kept as `*.bak-…`);
- adds the wallpaper to Wallpaper Engine: open *Installed* and pick **TheGrandees AI Office** (restart Wallpaper Engine if it is not in the list yet);
- adds a hidden Windows task. Every minute it checks whether Wallpaper Engine is open and starts the office server if needed. The server stops by itself about a minute after Wallpaper Engine closes. There is no tray icon and no window.

Codex only: open Codex, type `/hooks` and approve the AI-Office hooks once. Restart Claude Code and Codex so they pick up the hooks.

### macOS 12 or newer

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/macos/install.sh | bash
```

No admin password needed. It installs `~/Applications/TGTI AI Office.app`, uses your Node.js or downloads a private copy, adds the hooks and opens the app at login.
- The office becomes your **desktop wallpaper** (behind the desktop icons). Your normal wallpaper comes back when you quit.
- On a MacBook with a **notch**, touch the notch with the mouse and the office drops down as a panel. Move the mouse away and it slides back.
- The **menu bar icon** (a building) turns the wallpaper and the notch panel on or off, picks the season and weather, toggles sound, turns start-at-login on or off, and quits.
- The office server runs only while the app is open and stops when you quit it. Drawing pauses when the wallpaper is covered or the panel is hidden, to save the battery.

Test without any AI running: with the office open, run `node test-agent.mjs TEST` in the install folder. A test bot walks in, works, asks for permission, rests and leaves.

## Settings

- **Season and weather:** the buttons in the panel, or the *Season* and *Weather* properties in Wallpaper Engine's wallpaper settings.
- **Sound:** the *Sound* button in the panel, or the *Sound* and *Volume* properties in Wallpaper Engine (35% by default). In a normal browser the sound starts after the first click.
- **Hide the panel:** open `index.html#nohud` (the two buttons stay).
- **Preview with fake agents:** `index.html#demo`. Add `-winter`, `-night`, `-storm`, `-fog` and so on to force a look, for example `index.html#demo-summer-night-storm`. `-leave` makes one fake agent leave after 15 seconds to show the taxi, `-limo` puts GPT in the limousine.

## Privacy

- The hook sends the session id, the folder name, the event name, the tool name (`Bash`, `Edit`…), a process id and one short caption of what the agent is doing: a file name, the first word or two of a command (`git push`), a site's domain, or the first 6 characters of your prompt followed by "…". Full prompts, commands and code are never sent, and nothing leaves your PC.
- The server listens on `127.0.0.1:7777` only and is not reachable from other machines.
- The hook always exits successfully, so it never slows down or breaks Claude Code or Codex, even when the server is off.
- To see which programs are open, the server reads the process list every 4 seconds (PowerShell on Windows, `ps` on macOS). When the wallpaper is paused or hidden it checks only every 30 seconds.

## Remove

- Windows: `powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\TGTI-AI-Office\uninstall.ps1"`
- macOS: `curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/macos/uninstall.sh | bash`

Both remove the hooks, the autostart, the wallpaper and the private Node.js copy.

## Good to know

- Only programs installed on the computer are visible. ChatGPT or Claude in a browser tab, claude.ai cloud sessions and phones do not show up.
- Running the install command again updates the office to the newest version.

## Files

| File | What it does |
|---|---|
| `index.html` | the wallpaper: a 384×216 pixel scene scaled up without smoothing |
| `office-server.mjs` | local server: watches processes, receives hook events, serves `/state` |
| `hook.mjs` | tiny hook script called by Claude Code and Codex |
| `install-hooks.mjs` | adds or removes the hooks |
| `windows/` | Windows installer, uninstaller and `watch.vbs` (starts the server while Wallpaper Engine is open) |
| `macos/` | the Mac app (`main.swift`), its build script, installer and uninstaller |
| `install-hooks.cmd`, `start-office*.cmd`, `stop-office.cmd`, `autostart.cmd` | manual setup from a plain folder (for development) |
| `test-agent.mjs` | fake agent for testing |
| `fonts/` | [Tiny5](https://github.com/Gissio/font_tiny5) pixel font (SIL Open Font License) |

## License

Code: [MIT](LICENSE). Font in `fonts/`: SIL Open Font License 1.1 (`fonts/OFL.txt`).

Made by [TheGrandees](https://github.com/AlexanderGrandees) with Claude.
