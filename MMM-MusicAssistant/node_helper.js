/* node_helper.js — back-end adapter for MMM-MusicAssistant.
   This file holds no UI. Its only job is to talk to the Music Assistant server
   over its WebSocket API and hand the front-end a clean now-playing list.

   Flow on every poll (the front-end ticks every config.updateInterval seconds):
     1. open a WebSocket to ws://<host>:<port>/ws
     2. send the `auth` command with the long-lived token (REQUIRED on schema >= 28)
     3. send `players/all`
     4. map each player's current_media -> { name, state, artist, track, albumArt }
     5. send it back as MMM_MA_DATA and close the socket

   We open a short-lived session per poll on purpose: it mirrors the original
   MMM-Sonos request/response model and needs no reconnect/keepalive logic.
   Notes:
   06/23/2026 - Forked from MMM-Sonos; replaced the node-sonos-http-api HTTP GET
                with the Music Assistant WebSocket API (auth + players/all). */

const NodeHelper = require("node_helper");
const WebSocket = require("ws");

//Give the whole auth + query round-trip this long before we give up
const SESSION_TIMEOUT_MS = 8000;

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
            this.fetchNowPlaying(config);
        }
    },

    //Run one full MA session: connect -> auth -> players/all -> transform -> reply
    fetchNowPlaying: function (config)
    {
        const self = this;
        const wsUrl = `ws://${config.host}:${config.port}/ws`;
        const ws = new WebSocket(wsUrl);

        //Tracks in-flight commands so we can match each reply to its request
        const pending = new Map();
        let nextId = 1;

        //Bail out (and clean up) if the server never finishes the round-trip
        const timeout = setTimeout(function ()
        {
            console.error("MMM-MusicAssistant: timed out talking to " + wsUrl);
            try { ws.terminate(); } catch (e) { /* already gone */ }
        }, SESSION_TIMEOUT_MS);

        //Send a command and resolve with its `result`, matched on message_id
        function send(command, args)
        {
            return new Promise(function (resolve, reject)
            {
                const messageId = String(nextId++);
                pending.set(messageId, { resolve: resolve, reject: reject });
                ws.send(JSON.stringify({ message_id: messageId, command: command, args: args || {} }));
            });
        }

        ws.on("message", function (data)
        {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch (e) { return; }

            //Command responses carry the message_id we are waiting on
            if (msg.message_id && pending.has(msg.message_id))
            {
                const handler = pending.get(msg.message_id);
                pending.delete(msg.message_id);
                if (msg.error_code || msg.details)
                {
                    handler.reject(new Error((msg.error_code || "") + " " + (msg.details || "")));
                }
                else
                {
                    handler.resolve(msg.result);
                }
            }
            //The first frame is server_info — nothing to do; we just go straight to auth
        });

        ws.on("open", async function ()
        {
            try
            {
                //Schema >= 28 requires authenticating before any other command
                await send("auth", { token: config.token });

                //Pull every player, then keep only the ones we were asked for
                const players = await send("players/all");
                clearTimeout(timeout);
                self.sendSocketNotification("MMM_MA_DATA", self.toRoomList(players, config.players));
            }
            catch (err)
            {
                clearTimeout(timeout);
                console.error("MMM-MusicAssistant: " + err.message);
            }
            finally
            {
                try { ws.close(); } catch (e) { /* already closing */ }
            }
        });

        ws.on("error", function (err)
        {
            clearTimeout(timeout);
            console.error("MMM-MusicAssistant socket error: " + err.message);
        });
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
