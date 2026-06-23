/* MMM-MusicAssistant.js — MagicMirror² module (front-end).
   Adapted from CFenner's MMM-Sonos. Shows the current track + album art for one
   or more Music Assistant players ("rooms"). All server talk lives in
   node_helper.js; this file polls on an interval, holds the room list, and
   renders it.
   Notes:
   06/23/2026 - Forked from MMM-Sonos; retargeted from node-sonos-http-api to the
                Music Assistant HTTP API. Token + rooms hard-coded below.
   06/23/2026 - Helper confirmed delivering data, but the screen stayed on
                "Loading". Root cause: this Pi's MagicMirror is too old for
                nunjucks (.njk) templates. Dropped getTemplate/getTemplateData and
                build the DOM directly in getDom() so it renders on ANY MM version. */

Module.register("MMM-MusicAssistant", {
    defaults: {
        //--- Music Assistant server (hard-coded for this install) ---
        host: "192.168.124.50",
        port: 8095,
        //Long-lived token named "Magic Mirror" (valid to 2036). LAN-only secret.
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYVlMcklQOGoybHlqTUVqVEIxcnpyNTZWcEdTaExkRTUxVVdxb1pmT3BzIiwianRpIjoiSy1rR3hMbmU3enlLZ1J5aXIzOUNWWmh3bWgtOTlqSmJTY3B6d0NaNEdNWSIsImlhdCI6MTc4MjIzNzQ3MywiZXhwIjoyMDk3NTk3NDczLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwidG9rZW5fbmFtZSI6Ik1hZ2ljIE1pcnJvciIsImlzX2xvbmdfbGl2ZWQiOnRydWV9.ursmaYvP8sa4bfT3whUZKBSVaBYx3IVh9l5_5N_qX_E",
        //Which players to display. Empty array = every player that has something loaded.
        //Add/remove ids freely — these come straight from `players/all`.
        players: [
            "media_player.up_out_pool_20"
        ],

        //--- Display options (carried over from MMM-Sonos) ---
        showStoppedRoom: false,
        showAlbumArt: true,
        albumArtLocation: "right",
        showRoomName: true,
        animationSpeed: 1000,
        updateInterval: 30 //seconds between polls
    },

    roomList: [],
    loaded: false,

    start: function ()
    {
        Log.info("Starting module: " + this.name);
        //Fetch once right away, then poll on the configured interval
        this.update();
        setInterval(this.update.bind(this), this.config.updateInterval * 1000);
    },

    //Ask the helper to pull fresh now-playing data from MA
    update: function ()
    {
        this.sendSocketNotification("MMM_MA_UPDATE", {
            host: this.config.host,
            port: this.config.port,
            token: this.config.token,
            players: this.config.players
        });
    },

    //Store the new list and only repaint when it actually changed
    updateRoomList: function (roomList)
    {
        this.loaded = true;
        if (JSON.stringify(this.roomList) === JSON.stringify(roomList))
        {
            return;
        }
        this.roomList = roomList;
        this.updateDom(this.config.animationSpeed);
    },

    getStyles: function ()
    {
        return [this.name + ".css"];
    },

    //Build the DOM by hand — no nunjucks template, so it works on every MM version
    getDom: function ()
    {
        const wrapper = document.createElement("div");
        wrapper.className = "mmm-ma";

        //Still waiting for the first data push from the helper
        if (!this.loaded)
        {
            const loading = document.createElement("div");
            loading.className = "dimmed light small";
            loading.textContent = this.translate("LOADING");
            wrapper.appendChild(loading);
            return wrapper;
        }

        const self = this;
        const flip = this.data.position.indexOf("left") === 0;
        const showArtLeft = this.config.showAlbumArt && this.config.albumArtLocation === "left";
        const showArtRight = this.config.showAlbumArt && this.config.albumArtLocation !== "left";

        const ul = document.createElement("ul");
        if (flip) { ul.className = "flip"; }

        //One <li> per room we want to show
        this.roomList.forEach(function (room)
        {
            //Honor the showStoppedRoom toggle
            if (room.state !== "PLAYING" && !self.config.showStoppedRoom) { return; }

            const li = document.createElement("li");
            const row = document.createElement("div");

            //Small helper to build an album-art block
            function makeArt()
            {
                const art = document.createElement("div");
                art.className = "art";
                const img = document.createElement("img");
                img.src = room.albumArt;
                art.appendChild(img);
                return art;
            }

            if (showArtLeft && room.albumArt) { row.appendChild(makeArt()); }

            //Artist + track stacked in the middle
            const name = document.createElement("div");
            name.className = "name normal medium";
            const artist = document.createElement("div");
            artist.textContent = room.artist;
            const track = document.createElement("div");
            track.textContent = room.track;
            name.appendChild(artist);
            name.appendChild(track);
            row.appendChild(name);

            if (showArtRight && room.albumArt) { row.appendChild(makeArt()); }

            li.appendChild(row);

            //Optional room/player name under the track
            if (self.config.showRoomName)
            {
                const roomName = document.createElement("div");
                roomName.className = "room xsmall";
                roomName.textContent = room.name;
                li.appendChild(roomName);
            }

            ul.appendChild(li);
        });

        wrapper.appendChild(ul);
        return wrapper;
    },

    socketNotificationReceived: function (notification, payload)
    {
        if (notification === "MMM_MA_DATA")
        {
            Log.debug("received MMM_MA_DATA");
            this.updateRoomList(payload);
        }
    }
});
