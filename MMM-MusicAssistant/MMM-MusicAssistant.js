/* MMM-MusicAssistant.js — MagicMirror² module (front-end).
   Adapted from CFenner's MMM-Sonos. Shows the current track + album art for one
   or more Music Assistant players ("rooms"). All server talk lives in
   node_helper.js; this file just polls on an interval, holds the room list,
   and feeds the template.
   Notes:
   06/23/2026 - Forked from MMM-Sonos; retargeted from node-sonos-http-api to the
                Music Assistant WebSocket API. Token + rooms hard-coded below. */

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
            "media_player.jay_s_office",
            "media_player.kitchen",
            "media_player.conference_room",
            "media_player.think_tank",
            "media_player.dining_room",
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
        return [`${this.name}.css`];
    },

    getTemplate: function ()
    {
        return `${this.name}.njk`;
    },

    getTemplateData: function ()
    {
        return {
            flip: this.data.position.startsWith("left"),
            loaded: this.loaded,
            showAlbumArtRight: this.config.showAlbumArt && this.config.albumArtLocation !== "left",
            showAlbumArtLeft: this.config.showAlbumArt && this.config.albumArtLocation === "left",
            showRoomName: this.config.showRoomName,
            showStoppedRoom: this.config.showStoppedRoom,
            roomList: this.roomList,
            labelLoading: this.translate("LOADING")
        };
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
