import express from "express";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { checkCity } from "https://esm.sh/gh/lynn89-eefje/jumbotron/src//lib/event.js";

const app = express();
app.use(express.json());

let db;

(async function() {
    db = await open({
        filename: "./events_database.db",
        driver: sqlite3.Database
    })

    await db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            name TEXT PRIMARY KEY,
            acceptedIDs TEXT DEFAULT '[]',
            liveshareData TEXT DEFAULT '{}'
        )
    `)
    console.log("Initialization complete");
})();

async function ensureEvent(eventName) {
    if (await checkCity(eventName) == false) {
        return false;
    }
    let event = await db.get("SELECT * FROM events WHERE name = ?", [eventName]);

    if (!event) {
        await db.run(`INSERT INTO events (name, acceptedIDs, liveshareData) VALUES (?, ?, ?)`, [eventName, '[]', '{}']);
        event = await db.get("SELECT * FROM events WHERE name = ?", [eventName]);
    }

    // This makes the output parseable for JS
    return [
        event.name, JSON.parse(event.acceptedIDs), JSON.parse(event.liveshareData)
    ];

}