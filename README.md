<div align="center">

# ðŸ”’ Locked In

**A deep-work companion that's truly yours: 100% local, 100% open source, zero telemetry.**

[![License: MIT](https://img.shields.io/badge/License-MIT-d4ff3f.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB.svg)](https://tauri.app)
[![Platform](https://img.shields.io/badge/Windows-10%2F11-0078D6.svg)]()

[â¬‡ï¸ Download the latest version](https://github.com/JuanArtxz/locked-in/releases/latest)

</div>

---

## What is this

Locked In is a Windows desktop focus tracker built for people whose routine is upside down. No rigid pomodoro, no fixed schedule, no account, no cloud: you hit **LOCK IN**, work, and the app records everything â€” honestly â€” into a SQLite database that never leaves your machine.

There's a pixel mascot that gets happier the longer you stay focused. It judges you when you open Discord. This is serious.

## âœ¨ Features

| | |
|---|---|
| â±ï¸ **Open sessions** | Count-up timer, pause/resume, 1â€“5 focus rating, breaks with overrun tracking |
| ðŸªž **Focus mirror** | Records which apps you actually used during a session (win32, fully local) |
| ðŸ•µï¸ **Honest AFK** | Left the PC? It notices and asks whether to deduct the time |
| ðŸŒ™ **Midnight-proof** | An 11pmâ€“3am session counts 1h yesterday + 3h today â€” automatically |
| âœ… **Hourly check-in** | Corner popup every hour (configurable): "what did you get done?" â€” with streaks |
| ðŸ˜¤ **Anti-procrastination** | 5 continuous minutes on Discord/Instagram/TikTok â†’ a pretty nudge with an angry mascot (watchlist is editable) |
| ðŸ“Š **Real analytics** | 6-month heatmap, week vs. your own average, best hour per project, distraction profile |
| ðŸ” **Weekly habits** | No fixed days, no schedule: a weekly target you tick whenever you did the thing |
| ðŸ’¡ **Local insights** | Rule-based observations about your own data (best hour, week vs. week, dominant app) â€” no AI, works offline |
| ðŸŽ¯ **Project goals** | Per-project hour targets with progress and the daily pace needed to hit a deadline |
| ðŸ‘¥ **Friends** | Add friends by unique username (request â†’ inbox â†’ accept), see who's focusing live, weekly ranking, join a friend's focus session |
| ðŸ–¥ï¸ **Floating overlay** | Tiny always-on-top window with the timer, the mascot and your daily goal bar |
| ðŸ† **Milestones** | 10h on a project, goal streaks, personal records â€” celebrated on the spot |
| ðŸ”„ **Auto-updates** | One click in the update popup: downloads, installs with a progress screen and restarts itself (cryptographically signed) |
| ðŸŒŽ **English / PT-BR** | Full UI in both languages, picked on first run |
| ðŸ”” **Custom notifications** | No Windows toasts â€” every notification is a custom in-app popup with the mascot |
| ðŸ’¾ **Daily backups** | Automatic local copy of your database, last 14 days |

## ðŸ” Privacy & security

- **Local first.** Your data lives in `%APPDATA%\dev.lockedin.app\locked-in.db`. By default, not a single byte leaves your machine.
- **Optional cloud account** (opt-in): create an account in Settings to back up your history and restore it on a new PC. Auth and storage run on Supabase with Row Level Security â€” every row is readable/writable only by its owner, enforced server-side. The key embedded in this repo is Supabase's *anon key*, which is public by design and grants nothing without RLS passing.
- **No third-party AI.** Insights are generated locally by simple rules over your own data â€” no API, no key, no cost, works offline.
- **Zero telemetry, zero analytics.**
- Network requests the app makes: update checks against this repository and cloud sync (only if you sign in). Nothing else.
- Updates are signed: the app only installs updates whose signature matches the public key baked into the binary.

## ðŸ“¦ Install

1. Grab the `.exe` from the [releases page](https://github.com/JuanArtxz/locked-in/releases/latest)
2. Install it (no admin needed)
3. LOCK IN ðŸ”’

> The installer isn't code-signed (certificates are expensive), so Windows SmartScreen may complain â€” "More info" â†’ "Run anyway". The entire source is right here, audit away.

## ðŸ› ï¸ Build from source

Prerequisites: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (MSVC Build Tools + WebView2).

```bash
git clone https://github.com/JuanArtxz/locked-in.git
cd locked-in
npm install
npm run tauri dev     # development
npm run tauri build   # installer lands in src-tauri/target/release/bundle/
```

## ðŸ§± Stack

**Tauri 2** (Rust) Â· **React 19** + TypeScript Â· **Tailwind CSS 4** Â· **SQLite** (tauri-plugin-sql) Â· Recharts

Time-critical logic (hourly check-in, procrastination watcher) runs on native Rust threads â€” immune to WebView2 timer throttling. Foreground-window and idle detection use win32 APIs (`GetForegroundWindow`, `GetLastInputInfo`) â€” no keyboard hooks, ever.

## ðŸ—‚ï¸ Code map

```
src/                      # React frontend
  components/             # screens: Home, Checkin, Habits, Week, Goals, Log, Stats, Settings
  components/Popup.tsx    # corner popup window (check-in, nudge, notices, updates)
  components/Overlay.tsx  # floating mini window
  components/Mascot.tsx   # the pixel mascot (7 moods, walks, celebrates)
  hooks/useFocusSession.ts# session state machine (pause, AFK, midnight split)
  lib/db.ts               # all SQLite access
  lib/i18n.ts             # full EN/PT dictionary
src-tauri/
  src/lib.rs              # Rust commands, watcher threads, tray, backup, update popup
  migrations/             # versioned database schema
```

## ðŸ¤ Contributing

Issues and PRs welcome. This is a personal, opinionated app â€” features that add telemetry or third-party AI won't be merged.

## ðŸ“„ License

[MIT](LICENSE) â€” do whatever you want, just keep the notice.

---

<div align="center">

Made with ðŸ”’ and a pixel mascot that believes in you.

</div>
