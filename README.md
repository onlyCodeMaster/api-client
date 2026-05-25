# api-client

A fast, native, Postman-style API client built with Tauri 2, React 18, and Rust.

Cross-platform desktop app (macOS / Linux / Windows) that gives you HTTP, WebSocket, and GraphQL requests in a small native binary instead of a half-gigabyte Electron download.

---

## Features

### Protocols
- **HTTP** — GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
- **WebSocket** — connect / send / receive / close, with arbitrary handshake headers (e.g. `Authorization`)
- **GraphQL** — body type that auto-wraps `{ query, variables }`

### Request building
- URL bar with query parameters editor
- Headers editor (toggleable rows, drag-to-reorder)
- Body types: `none` / JSON / text / XML / form-data / GraphQL
- form-data with **file upload** (native file picker)
- Auth: Bearer, Basic, API Key (header or query)
- Per-request timeout (with a global default)
- Per-request **TLS verification** override (default: verify)
- Request cancellation (`Esc`)

### Variables & secrets
- Multiple environments, switchable from the sidebar
- `{{var}}` interpolation in URL, params, headers, body, and auth fields
- Variables flagged `is_secret` are stored in the **OS keychain**, not in plain JSON
- Auth secrets (bearer tokens, basic passwords, API keys) are likewise persisted to the keychain when saved to a collection; the on-disk JSON only contains blanks

### Cookies
- Real cookie jar wired into the HTTP client — `Set-Cookie` from responses is sent on subsequent requests
- Persisted across app restarts in SQLite
- Cookies panel for browsing, deleting, and clearing by domain

### Organization
- Multi-tab requests (open / close / reorder, `⌘T` / `⌘W`)
- Collections with nested folders, drag-and-drop reorder
- Workspace state (active request, environment, panel layout) saved across restarts
- Search history by URL or request name

### Import / export
- **cURL** — paste a `curl …` command to import, copy any request as a one-liner
- **Postman v2.x** — import and export full collections
- **Code generation** — fetch, axios, node:http, Python `requests`, Go `net/http`, Rust `reqwest`

### Response viewer
- JSON pretty-print with syntax highlighting (zero-dependency)
- In-body search with highlight
- Status / timing / size badges
- Headers tab

### UX
- Dark / light theme that follows the system
- Keyboard shortcuts: `⌘↵` send, `⌘N`/`⌘T` new tab, `⌘W` close tab, `⌘L` focus URL, `Esc` cancel
- Native menu integration via Tauri

---

## Development

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| Rust | stable |
| Tauri system deps | see [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) |

On Ubuntu / Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

### Run

```bash
npm install
npm run tauri dev
```

The Vite dev server runs at <http://localhost:1420> and Tauri loads it as the
desktop frontend. For a web-only preview without the Rust backend, use
`npm run dev`.

### Build

```bash
npm run tauri build
```

Produces a native installer in `src-tauri/target/release/bundle/`.

### Type-check / Rust check

```bash
npm run build               # tsc + vite build
(cd src-tauri && cargo check)
```

---

## Repository layout

```
├─ src/                       React 18 + TypeScript frontend
│  ├─ App.tsx                 Layout, keyboard shortcuts, WS event listener
│  ├─ components/             Sidebar, RequestPanel, ResponsePanel, …
│  ├─ store/useRequestStore   Single Zustand store (tabs, history, env, …)
│  ├─ utils/curl.ts           cURL ⇄ RequestItem
│  ├─ utils/postman.ts        Postman v2.x ⇄ Collection
│  └─ utils/codegen.ts        Codegen for 6 targets
├─ src-tauri/
│  ├─ src/lib.rs              HTTP / WebSocket / cookie jar / Tauri commands
│  ├─ src/db.rs               SQLite (history, settings, cookies, recent)
│  ├─ src/storage.rs          Filesystem JSON (collections, environments, workspace)
│  └─ src/secrets.rs          OS keychain (env-scoped + auth-scoped secrets)
└─ src-tauri/icons/           Platform-specific app icons
```

---

## Data locations

| Data | Location |
|---|---|
| SQLite (history / cookies / settings) | `$DATA/com.apiclient.dev/api-client.db` |
| Collections (JSON, one file per collection) | `$DATA/com.apiclient.dev/collections/*.json` |
| Environments (JSON) | `$DATA/com.apiclient.dev/environments/*.json` |
| Workspace state (JSON) | `$DATA/com.apiclient.dev/workspaces/*.json` |
| Secrets (auth / env `is_secret`) | OS keychain under service `com.apiclient.dev` |

`$DATA` is the platform's user data dir: `~/Library/Application Support` on macOS, `~/.local/share` on Linux, `%APPDATA%` on Windows.

Collection and environment JSON files are **safe to back up or sync**: they never contain real secrets, just empty placeholders where the keychain takes over.

---

## License

Not yet specified.
