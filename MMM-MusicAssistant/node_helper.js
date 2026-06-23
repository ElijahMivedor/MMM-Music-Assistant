/* node_helper.js — back-end adapter for MMM-MusicAssistant.
   This file holds no UI. Its only job is to ask the Music Assistant server for
   the current players and hand the front-end a clean now-playing list.

   How it talks to MA: a plain HTTP POST to the server's JSON-RPC endpoint.
     POST http://<host>:<port>/api
       header: Authorization: Bearer <long-lived-token>
       body:   {"command":"players/all"}
     -> responds with the players array directly (HTTP 200).

   Why HTTP and not the WebSocket API: MagicMirror on the Pi runs an OLD Node
   (pre-7.6) with no async/await and no global WebSocket, and the `ws` package
   needs Node 10+. The built-in `http` module + callbacks works on any Node, so
   this has ZERO npm dependencies (no `npm install` needed).

   Flow on every poll (front-end ticks every config.updateInterval seconds):
     1. POST players/all with the Bearer token
     2. map each player's current_media -> { name, state, artist, track, albumArt }
     3. send it back as MMM_MA_DATA
   Notes:
   06/23/2026 - Forked from MMM-Sonos; first cut used the MA WebSocket API.
   06/23/2026 - Pi runs Node <7.6 (no async/await, no ws): switched to the
                built-in `http` module hitting MA's POST /api endpoint instead. */

const NodeHelper = require("node_helper");
const http = require("http");

//Give the request this long before we give up
const REQUEST_TIMEOUT_MS = 8000;

module.exports = NodeHelper.create({
    start: function ()
    {
        console.log("MMM-MusicAssistant helper started ...");
    },

    //Front-end asks for fresh data on every tick
    socketNotificationReceived: function (notification, config)
    {
        if (notification === "MMM_MA_UPDATE")
        {
            //DEBUG: confirms the front-end actually reached the helper
            console.log("MMM-MusicAssistant: poll received -> fetching from " + config.host + ":" + config.port);
            this.fetchNowPlaying(config);
        }
    },

    //POST players/all to MA, then transform + reply
    fetchNowPlaying: function (config)
    {
        const self = this;
        const body = JSON.stringify({ command: "players/all" });

        const options = {
            host: config.host,
            port: config.port,
            path: "/api",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                //Bearer token auth — required for the players/all command
                "Authorization": "Bearer " + config.token
            }
        };

        const req = http.request(options, function (res)
        {
            //Collect the whole response body
            let data = "";
            res.setEncoding("utf8");
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function ()
            {
                if (res.statusCode !== 200)
                {
                    console.error("MMM-MusicAssistant: HTTP " + res.statusCode + " from /api: " + data);
                    return;
                }

                //Body is the players array directly
                let players;
                try { players = JSON.parse(data); }
                catch (e)
                {
                    console.error("MMM-MusicAssistant: bad JSON from /api: " + e.message);
                    return;
                }

                //DEBUG: confirms the fetch worked and shows what we're sending back
                const rooms = self.toRoomList(players, config.players);
                console.log("MMM-MusicAssistant: got " + players.length + " players, sending " + rooms.length + " room(s) to front-end");
                self.sendSocketNotification("MMM_MA_DATA", rooms);
            });
        });

        //Network-level failure (server down, wrong host, etc.)
        req.on("error", function (err)
        {
            console.error("MMM-MusicAssistant request error: " + err.message);
        });

        //Don't let a stalled request pile up across polls
        req.setTimeout(REQUEST_TIMEOUT_MS, function ()
        {
            console.error("MMM-MusicAssistant: timed out talking to " + config.host);
            req.abort();
        });

        req.write(body);
        req.end();
    },

    //Map MA player objects into the { name, state, artist, track, albumArt } shape the template renders
    toRoomList: function (players, wantedIds)
    {
        //Empty/missing list means "show every player that has something loaded"
        const filter = wantedIds && wantedIds.length ? wantedIds : null;
        const rooms = [];

        players.forEach(function (p)
        {
            //Skip players we did not ask for
            if (filter && filter.indexOf(p.player_id) === -1) { return; }

            //Nothing loaded on this player -> nothing to show
            const cm = p.current_media;
            if (!cm) { return; }

            //MA reports lowercase states; normalize to the template's PLAYING/STOPPED check
            const isPlaying = (p.playback_state || p.state) === "playing";

            rooms.push({
                name: p.display_name || p.name,
                state: isPlaying ? "PLAYING" : "STOPPED",
                artist: (cm.artist || "").trim(),
                track: (cm.title || "").trim(),
                albumArt: (cm.image_url || "").trim()
            });
        });

        return rooms;
    }
});
