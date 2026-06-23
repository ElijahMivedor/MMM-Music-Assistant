/* MMM-MusicAssistant.js — MagicMirror² module (front-end).
   Adapted from CFenner's MMM-Sonos. Shows the current artist, track, and album
   cover for one or more Music Assistant players. All server talk lives in
   node_helper.js; this file polls on an interval, holds the room list, and
   renders it directly in getDom() (no nunjucks — works on old MagicMirror).
   Notes:
   06/23/2026 - Forked from MMM-Sonos; retargeted to the Music Assistant HTTP API.
   06/23/2026 - getDom() build (old MM has no .njk support). Token + room hard-coded.
   06/23/2026 - Final: 15s polling; show only artist/track/cover (no room name, no debug). */

Module.register("MMM-MusicAssistant", {
    defaults: {
        //--- Music Assistant server (hard-coded for this install) ---
        host: "192.168.124.50",
        port: 8095,
        //Long-lived token named "Magic Mirror" (valid to 2036). LAN-only secret.
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYVlMcklQOGoybHlqTUVqVEIxcnpyNTZWcEdTaExkRTUxVVdxb1pmT3BzIiwianRpIjoiSy1rR3hMbmU3enlLZ1J5aXIzOUNWWmh3bWgtOTlqSmJTY3B6d0NaNEdNWSIsImlhdCI6MTc4MjIzNzQ3MywiZXhwIjoyMDk3NTk3NDczLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwidG9rZW5fbmFtZSI6Ik1hZ2ljIE1pcnJvciIsImlzX2xvbmdfbGl2ZWQiOnRydWV9.ursmaYvP8sa4bfT3whUZKBSVaBYx3IVh9l5_5N_qX_E",
        //Which players to display. Empty array = every player that has something loaded.
        players: ["media_player.up_out_pool_20"],

        //--- Display options ---
        showStoppedRoom: true,     //show the tile even when paused/stopped
        showAlbumArt: true,
        albumArtLocation: "right", //"left" or "right"
        animationSpeed: 1000,
        updateInterval: 15         //seconds between polls
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

    //Store the new list; repaint on first load and whenever it changed
    updateRoomList: function (roomList)
    {
        var changed = !this.loaded || JSON.stringify(this.roomList) !== JSON.stringify(roomList);
        this.loaded = true;
        this.roomList = roomList;
        if (changed)
        {
            this.updateDom(this.config.animationSpeed);
        }
    },

    getStyles: function ()
    {
        return [this.name + ".css"];
    },

    //Build the DOM by hand — no template, so it renders on every MM version
    getDom: function ()
    {
        var wrapper = document.createElement("div");
        wrapper.className = "mmm-ma";

        //Still waiting for the first data push from the helper
        if (!this.loaded)
        {
            var loading = document.createElement("div");
            loading.className = "dimmed light small";
            loading.innerHTML = this.translate("LOADING");
            wrapper.appendChild(loading);
            return wrapper;
        }

        var self = this;
        var showArtLeft = this.config.showAlbumArt && this.config.albumArtLocation === "left";
        var showArtRight = this.config.showAlbumArt && this.config.albumArtLocation !== "left";

        var ul = document.createElement("ul");

        //One <li> per room: album cover + artist/track (no room name)
        this.roomList.forEach(function (room)
        {
            if (room.state !== "PLAYING" && !self.config.showStoppedRoom) { return; }

            var li = document.createElement("li");
            var row = document.createElement("div");

            function makeArt()
            {
                var art = document.createElement("div");
                art.className = "art";
                var img = document.createElement("img");
                img.src = room.albumArt;
                art.appendChild(img);
                return art;
            }

            if (showArtLeft && room.albumArt) { row.appendChild(makeArt()); }

            var name = document.createElement("div");
            name.className = "name normal medium";
            var artist = document.createElement("div");
            artist.textContent = room.artist;
            var track = document.createElement("div");
            track.textContent = room.track;
            name.appendChild(artist);
            name.appendChild(track);
            row.appendChild(name);

            if (showArtRight && room.albumArt) { row.appendChild(makeArt()); }

            li.appendChild(row);
            ul.appendChild(li);
        });

        wrapper.appendChild(ul);
        return wrapper;
    },

    socketNotificationReceived: function (notification, payload)
    {
        if (notification === "MMM_MA_DATA")
        {
            this.updateRoomList(payload);
        }
    }
});
