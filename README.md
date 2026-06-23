# MMM-MusicAssistant

A [MagicMirror²](https://magicmirror.builders/) module that shows what's currently
playing on a [Music Assistant](https://www.music-assistant.io/) player — **artist,
track, and album cover**.

It was adapted from [CFenner/MMM-Sonos](https://github.com/CFenner/MMM-Sonos) and
retargeted at Music Assistant. It is deliberately built to run on **very old
MagicMirror / Node** installs (pre-7.6 Node): it uses Music Assistant's plain HTTP
JSON-RPC endpoint instead of the WebSocket API, builds its DOM directly (no nunjucks
template), and has **zero npm dependencies**.

## How it works

- `node_helper.js` polls Music Assistant on an interval with a single HTTP request:
  `POST http://<host>:<port>/api` with an `Authorization: Bearer <token>` header and
  a body of `{"command":"players/all"}`. The server returns every player; the helper
  keeps the configured one(s), reads each player's `current_media`, and hands the
  front-end `{ name, state, artist, track, albumArt }`.
- `MMM-MusicAssistant.js` renders that in `getDom()` (artist, track, album cover).

The album-cover URL Music Assistant returns (`current_media.image_url`, an
`/imageproxy/...` link) is unauthenticated, so the browser loads it directly.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/ElijahMivedor/MMM-Music-Assistant.git MMM-MusicAssistant
```

No `npm install` needed — the module has no dependencies.

Then add it to `~/MagicMirror/config/config.js`:

```js
{ module: "MMM-MusicAssistant", position: "bottom_right" },
```

## Configuration

The defaults are baked into `MMM-MusicAssistant.js`; override any of them in the
`config` block above.

| Option | Default | Description |
|---|---|---|
| `host` | `"192.168.124.50"` | Music Assistant server IP/host |
| `port` | `8095` | Music Assistant server port |
| `token` | *(baked in)* | A Music Assistant long-lived token (Settings → create a token) |
| `players` | `["media_player.up_out_pool_20"]` | Player ids to show. `[]` = every player with something loaded |
| `showStoppedRoom` | `true` | Show the tile even when paused/stopped |
| `showAlbumArt` | `true` | Show the album cover |
| `albumArtLocation` | `"right"` | `"left"` or `"right"` of the text |
| `animationSpeed` | `1000` | Fade speed (ms) on update |
| `updateInterval` | `15` | Seconds between polls |

To find player ids, call `players/all` against your server (each object has a
`player_id`), or read them from the Music Assistant UI.

## Getting a token

In the Music Assistant web UI, create a long-lived token (Settings → Users / your
profile). The module sends it as a Bearer token. Music Assistant servers on schema
≥ 28 require authentication for `players/all`.

## License

MIT (inherited from MMM-Sonos).
