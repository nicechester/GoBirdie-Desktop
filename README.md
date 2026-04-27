# GoBirdie Desktop

A desktop app for analyzing golf round data from Garmin, Apple Watch, and Android. Built with Tauri 2, Rust, and vanilla JavaScript.

🇰🇷 [한국어 README](README.ko.md)

## Overview

Garmin watches store golf activity data in two separate FIT files per round:

- **Activity file** (`GARMIN/Activity/`) — GPS track, heart rate timeline, shot detections, health metrics
- **Scorecard file** (`GARMIN/SCORCRDS/`) — per-hole scores, putts, fairways, GIR, course definition

This app reads both files, links them by timestamp, and presents a combined view of golf performance and health data. It also syncs rounds from iPhone (via local WiFi) and Android (via local WiFi + mDNS).

## Features

### Overview Tab
Round summary with score, distance walked, calories, avg/max HR, altitude range, and avg swing tempo. Includes a hole-by-hole scorecard with color-coded results (eagle/birdie/par/bogey), GIR, fairways hit, and a health section showing Body Battery drain, stress, and HR zone breakdown.

![Overview](images/overview.png)

### Shot Map Tab
Interactive map showing every shot as a colored line and dot, color-coded by club category (Driver, Fairway Wood, Iron, Wedge, Putter). Features:
- Hole selector buttons to zoom into individual holes
- Club abbreviation labels (`Dr`, `W3`, `I7`, `PW`, `H` etc.) next to each shot dot
- Distance in yards on each shot line
- Putt count shown inline next to each hole number marker
- Shot popups showing club, distance, elevation change (↑/↓), lie angle (ball above/below feet), HR sparkline, altitude, swing tempo, direction arrow (toward green), and strokes gained
- Lie angle fetched from Open-Topo-Data NED 10m (US) / SRTM 30m (global) — sampled ±10m perpendicular to shot bearing
- GPS trail toggle to show walking path
- Round Timeline chart below the map showing HR, altitude, stress, and swing tempo over time with hole markers

![Shot Map](images/shotmap1.png)
![Shot Map — hole detail](images/shotmap2.png)

### Club Performances Tab
Breakdown of tee shots, approach shots, wedges, and putting with direction analysis (left/straight/right toward green), avg/max distance, elevation change, lie angle, and a club summary table.

![Club Performances](images/clubperformance1.png)
![Club Performances — club summary](images/clubperformance2.png)

### Shot Analysis Tab
Strokes Gained analysis based on Mark Broadie's *Every Shot Counts* methodology using a 15-handicap amateur baseline. Features:
- Summary cards: total SG and per-category (Off the Tee, Approach, Short Game, Putting)
- Horizontal bar chart showing gain/loss by category
- Best and worst 3 shots highlight
- Club analysis table with mis-shot tendency (direction bias), distance consistency rating (★★★ to ☆☆☆), and avg SG per club
- Shot dispersion heatmaps grouped by distance-to-green bucket (0–50, 51–100, 101–150, 151–200, 200+ yds)
- Per-hole breakdown table with per-shot SG badges

![Shot Analysis — strokes gained](images/shotanalysis1.png)
![Shot Analysis — dispersion](images/shotanalysis2.png)
![Shot Analysis — per hole](images/shotanalysis3.png)

### Swing Tempo
Swing tempo is captured from mesg #104 in the activity FIT file as a 5-minute rolling average. The ratio (backswing:downswing) is displayed in the round header, on the timeline chart as green dots, and in individual shot popups when available.

### Ask AI
The ✨ Ask AI button builds a comprehensive markdown prompt from all round data — scorecard, shot details, strokes gained, club analysis, shot dispersion patterns, swing tempo, and a full 1-minute health timeline — and copies it to the clipboard ready to paste into [Gemini](https://gemini.google.com) or [ChatGPT](https://chatgpt.com).

![Ask AI](images/ask-ai.png)

## Download

Pre-built macOS and Windows binaries are available on the [Releases page](https://github.com/nicechester/GoBirdie-Desktop/releases).

## Sync Sources

On first launch, select your device type:

| Device | Sync Method |
|--------|-------------|
| **Garmin Watch** | USB cable (macOS: libmtp / Windows: WPD) |
| **Apple Watch** | Local WiFi via mDNS — macOS only |
| **Android** | Local WiFi via mDNS — enable Sync Server in GoBirdie Android Settings |

## Build

### macOS
```bash
bash build.sh
```

### Windows
```bat
build.bat
```

Requires Visual Studio 2022 with C++ workload and Rust toolchain.

## Architecture

```
GoBirdie-Desktop/
├── src-tauri/              Rust backend
│   ├── src/
│   │   ├── main.rs         Tauri entry point, command registration
│   │   ├── models.rs       Data structures (GolfRound, Scorecard, etc.)
│   │   ├── parser.rs       FIT file parsing
│   │   ├── store.rs        Sled-based persistence
│   │   ├── mtp.rs          MTP watch sync (macOS: libmtp / Windows: WPD)
│   │   ├── apple_sync.rs   iPhone sync via MultipeerConnectivity helper
│   │   ├── android_sync.rs Android sync via HTTP + mDNS discovery
│   │   └── native/
│   │       ├── garmin_mtp.c             macOS libmtp helper
│   │       └── garmin_mtp_windows.cpp   Windows WPD helper
│   ├── Cargo.toml
│   └── tauri.conf.json
├── web/                    Frontend (vanilla JS + Tailwind)
│   ├── index.html
│   └── js/
│       ├── app.js
│       ├── i18n.js
│       ├── nlg-templates.js
│       └── nlg-engine.js
├── build.sh                macOS build script
├── build.bat               Windows build script
└── vite.config.js
```

## Internationalization

The app supports English and Korean. A flag-based language toggle in the header switches all UI strings, NLG insights, and date formatting. Language preference is persisted in `localStorage`.
