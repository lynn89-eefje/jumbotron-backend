import express, { raw } from "express";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import * as jose from "jose";

const environment_clientSecret = "x";
const environment_masterKey = "x";


const app = express();
app.use(express.json());

const JWKS = jose.createRemoteJWKSet(new URL("https://auth.hackclub.com/oauth/discovery/keys"));

let db;
let validCitiesCache = [];
async function cacheCities() {
    try {
        const rawData = await fetch("https://raw.githubusercontent.com/lynn89-eefje/jumbotron-events/refs/heads/main/data.json");
        const data = await rawData.json();
        validCitiesCache = data.map(event => event.eventName);
        console.log("Cached events");
    }
    catch(err) {
        console.log("Failed to cache cities: ", err);
    }
}
function checkCity(cityName) {
    if (validCitiesCache.indexOf(cityName) == -1) {
        return false;
    }
    return true;
}

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
    await cacheCities();
    console.log("Initialization complete");
    setInterval(cacheCities, 5*60*1000);
})();

async function ensureEvent(eventName) {
    if (checkCity(eventName) == false) {
        return false;
    }
    let event = await db.get("SELECT * FROM events WHERE name = ?", [eventName]);

    if (!event) {
        const statement = await db.prepare("INSERT INTO events (name, acceptedIDs, liveshareData) VALUES (?, ?, ?)");
        await statement.run([eventName, '[]', '{}']);
        await statement.finalize();
        event = { name: eventName, acceptedIDs: '[]', liveshareData: '{}'};
    }

    // This makes the output parseable for JS
    return [
        event.name, JSON.parse(event.acceptedIDs), JSON.parse(event.liveshareData)
    ];

}

app.get("/data", async function(req, res) {
    const {eventName} = req.query;
    if (!eventName) { // Don't use eventName == false
        return res.status(400).json({error: "Missing eventName query parameter"});
    }

    try {
        const response = await ensureEvent(eventName);
        if (response == false) {
            return res.status(404).json({error: "Invalid eventName value; did not find event"});
        }

        const [name, acceptedIDs, liveshareData] = response;
        res.status(200).json({data: liveshareData});
    }
    catch (err) {
        return res.status(500).json({error: err.message});
    }
})

async function validateAuth(authCode) {
    try {
        const response = await fetch("https://auth.hackclub.com/oauth/token",
            {
                method: "POST",
                body: JSON.stringify({
                        "client_id": "e86d4d7eec9c546e6c4700388d4fea7f",
                        "client_secret": environment_clientSecret,
                        "redirect_uri": "https://curly-bassoon-6vrjgqpjpjjhwj6-5173.app.github.dev/jumbotron/",
                        "code": authCode,
                        "grant_type": "authorization_code"
                    }),
                headers: {
                    "Content-type": "application/json; charset=UTF-8"
                }
            }
        )

        if (!response || !response.ok) {
            return null
        }

        const data = await response.json();
        const token = data.id_token;

        if (!token) {
            return null;
        }

        const { payload } = await jose.jwtVerify(token, JWKS, {
            algorithms: ["RS256"]
        });

        return payload.sub;
    }
    catch(err) {
        console.log("Failed to validate token", authCode);
        return null;
    }
}

app.post("/editData", async function(req, res) {
    const { eventName, authCode, liveshareData } = req.body;
    if (!eventName || !authCode || !liveshareData) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }

    try {
        const response = await ensureEvent(eventName);
        if (response == false) {
            return res.status(400).json({error: "Invalid eventName value; did not find event"});
        }
        const [name, acceptedIDs, currentLiveshareData] = response;
        const slackID = await validateAuth(authCode);
        if (!slackID) {
            return res.status(401).json({error: "Invalid OAuth passed through parameter"});
        }
        if (acceptedIDs.indexOf(slackID) == -1) {
            return res.status(403).json({error: "Provided OAuth does not have permission to edit this event"});
        }
        const statement = await db.prepare("UPDATE events SET liveshareData = ? WHERE name = ?");
        await statement.run([JSON.stringify(liveshareData), name]);
        statement.finalize();

        res.status(200).json({success: true, liveshareData: liveshareData});

    }
    catch (err) {
        return res.status(500).json({error: err.message});
    }
})

app.post("/addID", async function(req, res) {
    const { eventName, masterKey, newID } = req.body;
    if (!eventName || !masterKey || !newID) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    try {
        if (masterKey != environment_masterKey) {
            return res.status(403).json({error: "Provided authenticaton key invalid"});
        }
        const response = await ensureEvent(eventName);
        if (!response) {
            return res.status(400).json({error: "Invalid eventName value; did not find event"});
        }
        const [name, currentIDs, currentData] = response;
        if (currentIDs.indexOf(newID) != -1) {
            return res.status(400).json({error: "Requested ID is already permitted for this event"});
        }

        let acceptedIDs = currentIDs;
        acceptedIDs.push(newID);

        const statement = await db.prepare("UPDATE events SET acceptedIDs = ? WHERE name = ?");
        await statement.run([JSON.stringify(acceptedIDs), name]);
        statement.finalize()
        
        res.status(200).json({success: true, addedID: newID});
    }
    catch(err) {
        return res.status(500).json({error: err.message});
    }
})

app.post("/removeID", async function(req, res) {
    const { eventName, masterKey, removalID } = req.body;
    if (!eventName || !masterKey || !removalID) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    try {
        if (masterKey != environment_masterKey) {
            return res.status(403).json({error: "Provided authenticaton key invalid"});
        }
        const response = await ensureEvent(eventName);
        if (!response) {
            return res.status(400).json({error: "Invalid eventName value; did not find event"});
        }
        const [name, currentIDs, liveshareData] = response;

        let removedIDs = currentIDs.filter((key) => key != removalID);
        if (removedIDs.length == currentIDs.length) {
            return res.status(404).json({error: "Provided ID for removal is not active anyway"});
        }

        const statement = await db.prepare("UPDATE events SET acceptedIDs = ? WHERE name = ?");
        await statement.run([JSON.stringify(removedIDs), name]);
        statement.finalize();
        res.status(200).json({success: true, removedID: removalID});
    }
    catch(err) {
        return res.status(500).json({error: err.message});
    }
})

const port = 3000;
app.listen(port, function() {
    console.log(`Jumbotron running on port ${port}`);
});