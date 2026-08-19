# Rust Server Manager LitvinBY

A desktop utility for Windows and Linux designed to manage dedicated Rust servers. Monitor processes, RCON, mods, wipes, and backups — all within a single, streamlined window.

**Important:** This is an unofficial project. It is not affiliated with Facepunch Studios. The names "Rust" and "Oxide" belong to their respective owners.

## Features

### 🖥️ Server Management
* **Process Control:** Start, stop, and restart `RustDedicatedServer.exe`. If the manager restarts, it automatically hooks back into the active server process.
* **Built-in Watchdog:** Automatically restarts the server upon crashes (up to 3 times per 30 minutes) or if the server console freezes.
* **Smart Configs:** Generates secure RCON passwords and strips broken quotes in `server.cfg` for values containing spaces.
* **Flexible Settings:** Manage game modes (vanilla, softcore, hardcore, primitive), save paths, maps (Procedural, CraggyIsland, custom URL), tags, tickrate, ports, and wipe schedules.
* **One-Click Updates:** Update your server and Oxide via SteamCMD with a real-time visual download progress bar.

### 💬 RCON & Player Management
* **WebRcon Support:** Fully compliant with the Facepunch standard, featuring an automatic fallback connection system.
* **Live Feeds:** Access a real-time console log, live chat stream, and quick-command shortcuts.
* **Player Administration:** View players online, manage ban lists, execute kick/ban actions, and set temporary bans with automated unban scheduling.

### 🧩 Plugins & Oxide (uMod)
* **Seamless Installation:** Install, update, and completely remove Oxide (uMod) directly into the server root directory.
* **Plugin Scanner:** Scan active plugins, temporarily disable them via `.disabled` extensions, and edit JSON configurations using a built-in editor.
* **uMod Catalog Integration:** Browse the uMod directory directly from the app. View descriptions, download counts, and install `.cs` plugins on the fly.

### 🔄 Wipes, Backups & Automation
* **Manual Wipes:** Clean `.map` and `.db` files, generate new seeds, and toggle automated server stop/start cycles.
* **Advanced Task Scheduler:** Automate wipes, daily restarts with customizable in-game chat warnings, and rotating automated backups. The scheduler runs on the main process, meaning it won't interrupt even if you close the UI window.
* **World Backups:** Create, restore, and delete world backups effortlessly.

### 📊 Monitoring & Notifications
* **Real-Time Metrics:** Tracks active players, server FPS, CPU load, and RAM usage.
* **Historical Analytics:** View player count and performance history charts filtered by day, week, or month.
* **Log Viewer:** Browse comprehensive server logs with built-in search and category filters.
* **Instant Alerts:** Supports Windows native push notifications + Discord and Telegram webhook alerts.

### 🌐 Infrastructure & Networking
* **Background Mode:** Minimize to system tray, enable run on Windows startup, and trigger automatic server boots.
* **Port Management Tab:** Identify which process is conflicting with your ports, create Windows Firewall rules (requires Administrator/UAC elevation), and verify external port availability via TCP.
* **Cross-Platform Linux Support:** Native `RustDedicated` process handling, SteamCMD beta branches (`-beta`), process tracking via `ps`, port analysis via `ss`/`netstat`, `.desktop` autostart integration, and automated CI builds for AppImage/deb.
* **Data Portability:** Export/import server profiles and configurations, with built-in full RU/EN localization.

---

## Tech Stack

* **Frontend UI:** React 18, TypeScript, Tailwind CSS, lucide-react
* **Backend Core:** Electron 29, Vite 5, i18next
* **Runtime & Utilities:** Node.js, `ws` (WebRcon), `pidusage`, `adm-zip`
* **Testing:** Built-in `node:test` (zero external dependencies)
* **Bundling:** electron-builder (NSIS + portable packages)

---

## Quick Start

### Prerequisites
* Node.js 20+
* Windows or Linux OS (Note: Windows Firewall management requires Administrator privileges).

### Development Setup
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Launch Vite dev-server:**
   ```bash
   npm run dev
   ```
3. **Compile main process & open Electron window:**
   ```bash
   npm run electron:dev
   ```

### Quality Assurance & Building
* **Type-check renderer:** `npm run typecheck`
* **Run unit tests:** `npm test` (compiles main process + runs tests)
* **Production build:** `npm run build` (compiled installers will be generated in the `/release` folder)

---

## Project Structure

* `electron/` — Main process: IPC contracts, watchdog, RCON client, scheduler, and alert services.
* `src/` — React frontend interface: pages, component tabs, and global context providers.
* `tests/` — Test suites powered by `node:test`.
* `scripts/` — Auxiliary helper utilities (e.g., asset and icon generators).
* `build/` — Build assets, branding graphics, and application icons.

*For deeper insights into the application architecture and IPC contracts, please refer to `ARCHITECTURE.md`.*

---

## Roadmap

* [ ] Facepunch official force-wipe calendar synchronization (first Thursday of every month)
* [x] Core server parameters configuration (passwords, EAC toggles, tickrate)
* [ ] Advanced Moderator Editor (`users.cfg` editing and Steam Group synchronization)
* [x] Custom map layouts via remote URL (`server.levelurl`)
* [x] SteamCMD beta branch selection
* [ ] Automated plugin configuration backup system
* [ ] Application self-updater via GitHub Releases

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
