/* Standalone verification script for the Music Assistant WebSocket API.
   Purpose: prove we can pull Track Name + Album Cover from a specific player
   BEFORE building the MagicMirror module around it.

   What it does:
   - Connects to the MA server WebSocket at ws://<HOST>:8095/ws
   - Sends the `players/all` command
   - Prints each player's name + current_media (title / artist / album / image_url)
   - Downloads the album cover of the first playing (or first available) player
     into this repo folder as `api_albumcover_test.<ext>`

   No npm dependencies: Node 18+ ships global fetch, Node 22+ ships global WebSocket.

   Auth: MA server schema >= 28 (v2.x) requires an `auth` command with a token
   BEFORE any other command. Provide credentials via environment variables so
   nothing sensitive is committed:
     MA_TOKEN=<long-lived-token>   node verify-ma-api.js     (preferred)
       — or —
     MA_USER=<user> MA_PASS=<pass> node verify-ma-api.js     (REST-login first)

   Notes:
   06/23/2026 - Initial version.
   06/23/2026 - Added auth handshake (server is v2.9.2 / schema 31, auth required). */

const fs = require("node:fs");
const path = require("node:path");

//MA server on the LAN — change here if the IP moves
const HOST = "192.168.124.50";
const PORT = 8095;
const WS_URL = `ws://${HOST}:${PORT}/ws`;
const HTTP_BASE = `http://${HOST}:${PORT}`;

//Credentials pulled from the environment (never hardcoded)
const MA_TOKEN = process.env.MA_TOKEN || null;
const MA_USER = process.env.MA_USER || null;
const MA_PASS = process.env.MA_PASS || null;

//Optional: pin to a specific player_id; otherwise auto-pick the first playing one with a cover
const MA_PLAYER = process.env.MA_PLAYER || null;

//Where to drop the downloaded cover (next to this script)
const OUT_BASENAME = path.join(__dirname, "api_albumcover_test");

//Fail loudly if the server never answers
const TIMEOUT_MS = 10000;

//Send a single command and resolve with its `result`, matching on message_id
function sendCommand(ws, pending, command, args = {})
{
    return new Promise((resolve, reject) =>
    {
        //Cheap unique id per request
        const messageId = String(Date.now()) + "-" + Math.floor(Math.random() * 1e6);
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ message_id: messageId, command, args }));
    });
}

//Resolve an image reference to a full, fetchable URL
function resolveImageUrl(imageUrl)
{
    if (!imageUrl)
    {
        return null;
    }
    //PlayerMedia.image_url is usually already absolute; handle relative imageproxy paths too
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))
    {
        return imageUrl;
    }
    return HTTP_BASE + (imageUrl.startsWith("/") ? "" : "/") + imageUrl;
}

//Map a content-type to a file extension for the saved cover
function extForContentType(contentType)
{
    if (!contentType)
    {
        return ".jpg";
    }
    if (contentType.includes("png")) return ".png";
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("gif")) return ".gif";
    return ".jpg";
}

//Download the cover and write it to disk; returns the saved path
async function downloadCover(imageUrl)
{
    const url = resolveImageUrl(imageUrl);
    console.log(`\nDownloading album cover from: ${url}`);

    const res = await fetch(url);
    if (!res.ok)
    {
        throw new Error(`Image fetch failed: HTTP ${res.status} ${res.statusText}`);
    }

    const ext = extForContentType(res.headers.get("content-type"));
    const outPath = OUT_BASENAME + ext;

    //Stream response bytes to the file
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);

    console.log(`Saved ${buf.length} bytes -> ${outPath}`);
    return outPath;
}

//Trade username/password for a session token via the REST endpoint.
//Note: MA expects JSON with creds NESTED under `credentials`, and returns `token`.
async function restLogin(username, password)
{
    console.log(`Logging in via ${HTTP_BASE}/auth/login ...`);
    const res = await fetch(`${HTTP_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            provider_id: "builtin",
            credentials: { username, password },
            device_name: "MMM MA API test",
        }),
    });

    //Surface the server's own error message instead of a bare status
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.token)
    {
        throw new Error(`Login failed: HTTP ${res.status} ${data.error || res.statusText}`);
    }

    console.log(`Logged in as ${data.user?.display_name || data.user?.username || username}.`);
    return data.token;
}

async function main()
{
    //Resolve a token first: explicit token wins, else log in with user/pass
    let token = MA_TOKEN;
    if (!token && MA_USER && MA_PASS)
    {
        token = await restLogin(MA_USER, MA_PASS);
    }
    if (!token)
    {
        console.error("No credentials. Set MA_TOKEN, or MA_USER + MA_PASS. See header for usage.");
        process.exit(1);
    }

    console.log(`Connecting to Music Assistant at ${WS_URL} ...`);

    const ws = new WebSocket(WS_URL);

    //Tracks in-flight commands by message_id
    const pending = new Map();

    //Bail if nothing happens in time
    const timeout = setTimeout(() =>
    {
        console.error(`Timed out after ${TIMEOUT_MS}ms with no usable response.`);
        try { ws.close(); } catch {}
        process.exit(1);
    }, TIMEOUT_MS);

    ws.addEventListener("error", (ev) =>
    {
        console.error("WebSocket error:", ev.message || ev);
    });

    ws.addEventListener("close", () =>
    {
        clearTimeout(timeout);
    });

    //Route incoming frames: first the server_info handshake, then command results
    ws.addEventListener("message", (ev) =>
    {
        let msg;
        try
        {
            msg = JSON.parse(ev.data);
        }
        catch
        {
            return;
        }

        //Command response: has a message_id we are waiting on
        if (msg.message_id && pending.has(msg.message_id))
        {
            const { resolve, reject } = pending.get(msg.message_id);
            pending.delete(msg.message_id);

            if (msg.error_code || msg.details)
            {
                reject(new Error(`Server error: ${msg.error_code || ""} ${msg.details || ""}`.trim()));
            }
            else
            {
                resolve(msg.result);
            }
            return;
        }

        //First frame is the server info handshake — confirms we're talking to MA
        if (msg.server_version || msg.schema_version || msg.server_id)
        {
            console.log(`Connected. MA server v${msg.server_version ?? "?"} (schema ${msg.schema_version ?? "?"})`);
        }
    });

    ws.addEventListener("open", async () =>
    {
        try
        {
            //Schema >= 28 requires authenticating before any other command
            await sendCommand(ws, pending, "auth", { token });
            console.log("Authenticated.");

            //Pull every player the server knows about
            const players = await sendCommand(ws, pending, "players/all");
            clearTimeout(timeout);

            console.log(`\nFound ${players.length} player(s):\n`);

            //Print the bits we care about for each player
            let target = null;
            for (const p of players)
            {
                const cm = p.current_media || null;
                const state = p.playback_state ?? p.state ?? "unknown";
                console.log(`• ${p.display_name || p.name}  [id=${p.player_id}]  state=${state}`);
                if (cm)
                {
                    console.log(`    Track Name : ${cm.title ?? "(none)"}`);
                    console.log(`    Artist     : ${cm.artist ?? "(none)"}`);
                    console.log(`    Album      : ${cm.album ?? "(none)"}`);
                    console.log(`    Cover URL  : ${cm.image_url ?? "(none)"}`);
                }
                else
                {
                    console.log("    (nothing playing / no current_media)");
                }

                //If a specific player is pinned, only it can be the target
                if (MA_PLAYER)
                {
                    if (p.player_id === MA_PLAYER)
                    {
                        target = p;
                    }
                    continue;
                }

                //Otherwise prefer an actively-playing player that actually has a cover
                if (cm && cm.image_url)
                {
                    if (!target || state === "playing")
                    {
                        target = p;
                    }
                }
            }

            //Pinned-but-not-found is a clear error worth calling out
            if (MA_PLAYER && !target)
            {
                console.log(`\n⚠️  Player id "${MA_PLAYER}" was not found in players/all.`);
            }

            //Download the cover for the chosen player, if any
            if (target && target.current_media && target.current_media.image_url)
            {
                console.log(`\nUsing player "${target.display_name || target.name}" for the cover test.`);
                await downloadCover(target.current_media.image_url);
                console.log("\n✅ Verified: we can read Track Name + Album Cover from a specific player.");
            }
            else
            {
                console.log("\n⚠️  No player currently has an album cover (start playback on one, then re-run).");
            }

            ws.close();
        }
        catch (err)
        {
            clearTimeout(timeout);
            console.error("\n❌ Failed:", err.message);
            ws.close();
            process.exit(1);
        }
    });
}

main();
