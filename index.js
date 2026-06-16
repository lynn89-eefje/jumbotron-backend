import express from "express";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import * as jose from "jose";

// --- Configuration Setup ---
const environment_clientSecret = process.env.CLIENT_SECRET || "x";
const environment_masterKey = process.env.MASTER_KEY || "x";
const environment_internalKey = process.env.INTERNAL_KEY || "74f564db-7ee5-4dcf-ab3e-151e87ff4ea3";
const environment_base = "";

const app = express();
app.use(express.json());

// Set up keys
const JWKS = jose.createRemoteJWKSet(new URL("https://auth.hackclub.com/oauth/discovery/keys"));
const localSecret = new Uint8Array(Buffer.from(environment_internalKey, "utf-8"));

// --- Memory Cache for Valid Cities ---
let db;
let validCitiesCache = [];

async function cacheCities() {
    try {
        const rawData = await fetch("https://raw.githubusercontent.com/lynn89-eefje/jumbotron-events/refs/heads/main/data.json");
        const data = await rawData.json();
        validCitiesCache = data.map(event => event.eventName);
        console.log("Cached events");
    } catch(err) {
        console.error("Failed to cache cities: ", err);
    }
}

function checkCity(cityName) {
    return validCitiesCache.includes(cityName);
}

// --- Database & Cache Initialization ---
(async function() {
    db = await open({
        filename: "./events_database.db",
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            name TEXT PRIMARY KEY,
            acceptedIDs TEXT DEFAULT '[]',
            liveshareData TEXT DEFAULT '{}'
        )
    `);
    await cacheCities();
    console.log("Initialization complete");
})();

// --- Helper Functions ---
async function ensureEvent(eventName) {
    if (!checkCity(eventName)) {
        return false;
    }
    let event = await db.get("SELECT * FROM events WHERE name = ?", [eventName]);

    if (!event) {
        const statement = await db.prepare("INSERT INTO events (name, acceptedIDs, liveshareData) VALUES (?, ?, ?)");
        await statement.run([eventName, '[]', '{}']);
        await statement.finalize();
        event = { name: eventName, acceptedIDs: '[]', liveshareData: '{}' };
    }

    return [
        event.name, JSON.parse(event.acceptedIDs), JSON.parse(event.liveshareData)
    ];
}

async function validateAuth(authCode) {
    try {
        const response = await fetch("https://auth.hackclub.com/oauth/token", {
            method: "POST",
            body: JSON.stringify({
                "client_id": "e86d4d7eec9c546e6c4700388d4fea7f",
                "client_secret": environment_clientSecret,
                "redirect_uri": "https://curly-bassoon-6vrjgqpjpjjhwj6-5173.app.github.dev/jumbotron/",
                "code": authCode,
                "grant_type": "authorization_code"
            }),
            headers: { "Content-type": "application/json; charset=UTF-8" }
        });

        if (!response || !response.ok) {
            console.error(`[OAuth Fetch Error] Status: ${response?.status}`);
            try {
                const errData = await response.json();
                console.error("[OAuth Fetch Body]:", errData);
            } catch {
                console.error("[OAuth Fetch] Could not parse error body.");
            }
            return null;
        }

        const data = await response.json();
        const token = data.id_token;

        if (!token) return null;

        try {
            const { payload } = await jose.jwtVerify(token, JWKS, { algorithms: ["RS256"] });
            return payload.slack_id || payload.sub;
        } catch(err) {
            console.error("Failed JOSE Verification:", err.message);
            return null;
        }
    } catch(err) {
        console.error("Failed to validate token", authCode, err.message);
        return null;
    }
}

// --- API Routes ---

// 1. Session Token Exchange (Single-use OAuth Code converts to 30-Day Session)
app.post(`${environment_base}/login`, async function(req, res) {
    const { authCode } = req.body;
    if (!authCode) {
        return res.status(400).json({ error: "Missing parameter" });
    }
    
    const slackID = await validateAuth(authCode);
    if (!slackID) {
        return res.status(401).json({ error: "Invalid or expired authorization code" });
    }
    
    const sessionToken = await new jose.SignJWT({ slack_id: slackID })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(localSecret);

    res.status(200).json({ success: true, token: sessionToken });
});

// 2. Read Event Data
app.get(`${environment_base}/data`, async function(req, res) {
    const { eventName } = req.query;
    if (!eventName) {
        return res.status(400).json({ error: "Missing eventName query parameter" });
    }

    try {
        const response = await ensureEvent(eventName);
        if (response === false) {
            return res.status(404).json({ error: "Invalid eventName value; did not find event" });
        }

        const [name, acceptedIDs, liveshareData] = response;
        res.status(200).json({ data: liveshareData });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. Write Event Data (Uses Session Token)
app.post(`${environment_base}/editData`, async function(req, res) {
    const { eventName, sessionToken, liveshareData } = req.body;
    if (!eventName || !sessionToken || !liveshareData) {
        return res.status(400).json({ error: "Missing parameter(s)" });
    }

    try {
        const response = await ensureEvent(eventName);
        if (response === false) {
            return res.status(400).json({ error: "Invalid eventName value; did not find event" });
        }
        const [name, acceptedIDs] = response;
        
        let slackID;
        try {
            const identityJSON = await jose.jwtVerify(sessionToken, localSecret);
            slackID = identityJSON.payload.slack_id;
        } catch (jwtErr) {
            console.error("Local session validation failed:", jwtErr.message);
            return res.status(401).json({ error: "Invalid or expired session token. Please log in again." });
        }

        if (acceptedIDs.indexOf(slackID) === -1) {
            return res.status(403).json({ error: "Provided session token does not have permission to edit this event" });
        }

        const statement = await db.prepare("UPDATE events SET liveshareData = ? WHERE name = ?");
        await statement.run([JSON.stringify(liveshareData), name]);
        await statement.finalize();

        res.status(200).json({ success: true, liveshareData: liveshareData });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. Admin: Add Permitted Slack ID
app.post(`${environment_base}/addID`, async function(req, res) {
    const { eventName, masterKey, newID } = req.body;
    if (!eventName || !masterKey || !newID) {
        return res.status(400).json({ error: "Missing parameter(s)" });
    }
    try {
        if (masterKey !== environment_masterKey) {
            return res.status(403).json({ error: "Provided authentication key invalid" });
        }
        const response = await ensureEvent(eventName);
        if (!response) {
            return res.status(400).json({ error: "Invalid eventName value; did not find event" });
        }
        const [name, currentIDs] = response;
        if (currentIDs.indexOf(newID) !== -1) {
            return res.status(400).json({ error: "Requested ID is already permitted for this event" });
        }

        const acceptedIDs = [...currentIDs, newID];

        const statement = await db.prepare("UPDATE events SET acceptedIDs = ? WHERE name = ?");
        await statement.run([JSON.stringify(acceptedIDs), name]);
        await statement.finalize();
        
        res.status(200).json({ success: true, addedID: newID });
    } catch(err) {
        return res.status(500).json({ error: err.message });
    }
});

// 5. Admin: Remove Permitted Slack ID
app.post(`${environment_base}/removeID`, async function(req, res) {
    const { eventName, masterKey, removalID } = req.body;
    if (!eventName || !masterKey || !removalID) {
        return res.status(400).json({ error: "Missing parameter(s)" });
    }
    try {
        if (masterKey !== environment_masterKey) {
            return res.status(403).json({ error: "Provided authentication key invalid" });
        }
        const response = await ensureEvent(eventName);
        if (!response) {
            return res.status(400).json({ error: "Invalid eventName value; did not find event" });
        }
        const [name, currentIDs] = response;

        const removedIDs = currentIDs.filter((key) => key !== removalID);
        if (removedIDs.length === currentIDs.length) {
            return res.status(404).json({ error: "Provided ID for removal is not active anyway" });
        }

        const statement = await db.prepare("UPDATE events SET acceptedIDs = ? WHERE name = ?");
        await statement.run([JSON.stringify(removedIDs), name]);
        await statement.finalize();
        res.status(200).json({ success: true, removedID: removalID });
    } catch(err) {
        return res.status(500).json({ error: err.message });
    }
});

// 6. Admin: Get Authorized IDs for an Event
app.get(`${environment_base}/getIDs`, async function(req, res) {
    const { eventName, masterKey } = req.query;
    if (!eventName || !masterKey) {
        return res.status(400).json({ error: "Missing parameter(s)" });
    }
    if (masterKey !== environment_masterKey) {
        return res.status(403).json({ error: "Invalid authentication" });
    }
    try {
        let data = await ensureEvent(eventName);
        res.status(200).json({ success: true, keys: data[1] });
    } catch(err) {
        return res.status(500).json({ error: err.message });
    }
}); 

// 7. Admin: Force Refresh City Cache
app.post(`${environment_base}/cacheEvents`, async function(req, res) {
    const { auth } = req.body;
    if (!auth) {
        return res.status(400).json({ error: "No authentication provided" });
    }
    if (auth !== environment_masterKey) {
        return res.status(403).json({ error: "Invalid authentication provided" });
    }
    await cacheCities();
    res.status(200).json({ success: true });
});

// --- Server Startup ---
const port = 3000;
app.listen(port, function() {
    console.log(`Jumbotron running on port ${port}`);
});
app.set('trust proxy', 'loopback');