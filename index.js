import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";
dotenv.config();

const masterKey = process.env.MASTER;

const app = express();
app.use(express.json());
app.use(cors({
    origin: [
        "https://curly-bassoon-6vrjgqpjpjjhwj6-5173.app.github.dev",
        "https://jumbotron.hackclub.com"
    ],
    methods: [
        "POST", "GET"
    ],
    allowedHeaders: ["Content-Type", "Authorization"]
}))

let validCitiesCache = [];
let pocEmailsCache = [];

let refList = [
    {
        "eventName": "NYC",
        "poc": "shreyatodi3@gmail.com"
    },
    {
        "eventName": "San Francisco",
        "poc": "alisal.singyee@gmail.com"
    },
    {
        "eventName": "Austin",
        "poc": "lisedo147@gmail.com"
    },
    {
        "eventName": "Miami",
        "poc": "alisal.singyee@gmail.com"
    },
    {
        "eventName": "Atlanta",
        "poc": "charmwoodrum@gmail.com"
    },
    {
        "eventName": "Bogota",
        "poc": "beesfanalt@gmail.com"
    },
    {
        "eventName": "Boston",
        "poc": "vivithequeen1@gmail.com"
    },
    {
        "eventName": "Houston",
        "poc": "madison.o.mayer@gmail.com"
    },
    {
        "eventName": "London",
        "poc": "aishahisap123@gmail.com"
    },
    {
        "eventName": "Minneapolis",
        "poc": "spam@mediaology.com"
    },
    {
        "eventName": "Dhaka",
        "poc": "nosrathjahan16@gmail.com"
    },
    {
        "eventName": "DC",
        "poc": "rosed.20104@gmail.com"
    },
    {
        "eventName": "Sacramento",
        "poc": "bonilla.ellie@gmail.com"
    },
    {
        "eventName": "Seattle",
        "poc": "shsuri15@gmail.com"
    },
    {
        "eventName": "Tampa",
        "poc": "caitlindu10@gmail.com"
    },
    {
        "eventName": "Milwaukee",
        "poc": "saanvi4800@gmail.com"
    },
    {
        "eventName": "Charlotte",
        "poc": "taymonayc@gmail.com"
    },
    {
        "eventName": "Dallas",
        "poc": "suhanisharma072@gmail.com"
    },
    {
        "eventName": "Dundee",
        "poc": "yahannahsu@gmail.com"
    },
    {
        "eventName": "Hong Kong",
        "poc": "lu-cindy@outlook.com"
    },
    {
        "eventName": "Victoria",
        "poc": "sanadeghat@gmail.com"
    }
]

let events = [];
let sessions = [];

let clientID = "e86d4d7eec9c546e6c4700388d4fea7f";

async function cacheCities() {
    try {
        //const rawData = await fetch("https://raw.githubusercontent.com/lynn89-eefje/jumbotron-events/refs/heads/main/data.json");
        //const data = await rawData.json();
        let data = refList;
        validCitiesCache = data.map(event => event.eventName);
        pocEmailsCache = data.map(event => event.poc);
        console.log("Cached events");
    } catch(err) {
        console.error("Failed to cache cities: ", err);
    }
}

function checkCity(cityName) {
    return validCitiesCache.includes(cityName);
}

// Synchronous now, as it just looks up and pushes to a local array
function ensureEvent(eventName) {
    if (!checkCity(eventName)) {
        return false;
    }
    
    // Find event in our local list
    let event = events.find(e => e.name === eventName);

    // If it doesn't exist, create it and push it to the list
    if (!event) {
        event = { 
            name: eventName, 
            acceptedEmails: [pocEmailsCache[validCitiesCache.indexOf(eventName)]],
            liveshareData: {} 
        };
        events.push(event);
    }

    return [
        event.name, event.acceptedEmails, event.liveshareData
    ];
}

async function sendDataToSlack() {
    const slackToken = process.env.BOT_TOKEN;
    const channelId = process.env.CHANNEL_ID;
    const port = process.env.PORT || 3000;

    if (!slackToken || !channelId) {
        console.error("Missing Slack environment variables.");
        return;
    }

    // Step 1: Serialize the state into a structured payload object
    const innerJsonPayload = JSON.stringify({
        authKey: masterKey || 'your_master_key',
        eventsNew: events,
        sessionsNew: sessions
    });

    // Step 2: Convert the JSON text safely into an un-fakeable Base64 alphanumeric string.
    // This entirely avoids quotes, brackets, and spaces breaking your terminal shell environment!
    const base64Payload = Buffer.from(innerJsonPayload, 'utf-8').toString('base64');

    // Step 3: Format the one-liner terminal payload.
    // When pasted, the terminal automatically unpacks the Base64 data directly into curl's standard input.
    const copyPasteCommand = `echo "${base64Payload}" | base64 -d | curl -X POST "http://jumbotron.lynn89sudo.hackclub.app/masterOverride" -H "Content-Type: application/json" -d @-`;

    try {
        // Post directly to the chat channel as standard text instead of allocating file space links
        const response = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": `Bearer ${slackToken}`
            },
            body: JSON.stringify({
                channel: channelId,
                text: `🚨 *Jumbotron Snapshot Update* 🚨\nTotal Events: *${events.length}* | Total Sessions: *${sessions.length}*\n\n*Copy and paste this directly into your terminal to restore:* \n\`\`\`${copyPasteCommand}\`\`\``
            })
        });

        const result = await response.json();
        if (!result.ok) {
            console.error("Slack chat.postMessage Error:", result.error);
        } else {
            console.log("Interactive curl terminal snippet posted to Slack channel!");
        }
    } catch (err) {
        console.error("Failed to post terminal command snippet to Slack:", err);
    }
}

// --- Express Routes ---
app.get(`/data`, async function(req, res) {
    const { eventName } = req.query;
    if (!eventName) {
        return res.status(400).json({ error: "Missing eventName query parameter" });
    }

    try {
        const response = ensureEvent(eventName);
        if (response === false) {
            return res.status(404).json({ error: "Invalid eventName value; did not find event" });
        }

        const [name, acceptedEmails, liveshareData] = response;
        res.status(200).json({ data: liveshareData });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/acceptedEmails", async (req, res) => {
    let {authKey, cityName} = req.query;
    if (!authKey || authKey !== masterKey || !cityName) {
        return res.status(400).json({ error: "Missing parameter or invalid auth query parameter" });
    }
    
    const response = ensureEvent(cityName); // No longer needs await
    if (!response) {
        return res.status(400).json({error: "Invalid cityName"});
    }
    const [ acceptName, acceptedEmails, rawData ] = response;
    res.status(200).json({data: acceptedEmails});
});

app.post("/addEmail", async (req, res) => {
    let {authKey, cityName, emailAddress} = req.body;
    if (!authKey || !cityName || !emailAddress) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    if (authKey !== masterKey) {
        return res.status(401).json({error: "Invalid auth query parameter"});
    }
    let details = ensureEvent(cityName);
    if (!details) {
        return res.status(400).json({error: "Invalid cityName"});
    }
    for (let i = 0; i < events.length; i++) {
        if (events[i].name === cityName) {
            if (events[i].acceptedEmails.indexOf(emailAddress) === -1) {
                events[i].acceptedEmails.push(emailAddress);
                return res.status(200).json({message: "Added email"});
            }
            else {
                return res.status(400).json({error: "Email is already on the list"});
            }
        }
    }
    
})

app.post("/removeEmail", async (req, res) => {
    let {authKey, cityName, emailAddress} = req.body;
    if (!authKey || !cityName || !emailAddress) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    if (authKey !== masterKey) {
        return res.status(401).json({error: "Invalid auth query parameter"});
    }
    let details = ensureEvent(cityName);
    if (!details) {
        return res.status(400).json({error: "Invalid cityName"});
    }
    for (let i = 0; i < events.length; i++) {
        if (events[i].name === cityName) {
            if (events[i].acceptedEmails.indexOf(emailAddress) !== -1) {
                events[i].acceptedEmails = events[i].acceptedEmails.filter(e => e !== emailAddress);
                return res.status(200).json({message: "Removed email"});
            }
            else {
                return res.status(400).json({error: "Email is not on the list"});
            }
        }
    }
})

app.post("/mutate", async (req, res) => {
    let {auth, cityName, data} = req.body;
    if (!auth || !cityName || !data) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    let response = ensureEvent(cityName);
    if (!response) {
        return res.status(400).json({error: "Invalid cityName"});
    }
    if (auth !== masterKey) {
        if (!auth.emailAddress || !auth.key) {
            return res.status(400).json({error: "Invalid auth parameter"});
        }
        const [name, acceptedEmails] = response;
        if (acceptedEmails.indexOf(auth.emailAddress) === -1) {
            return res.status(400).json({error: "Invalid email"});
        }
        let validSet = sessions.find(e => e.key === auth.key && e.cityName === cityName);
        if (!validSet) {
            return res.status(401).json({error: "Invalid authentication"});
        }
        if (validSet.emailAddress !== auth.emailAddress) {
            return res.status(401).json({error: "Invalid authentication"});
        }
    }
    for (let i = 0; i < events.length; i++) {
        if (events[i].name === cityName) {
            events[i].liveshareData = data;
            return res.status(200).json({message: "Changed liveshare data"});
        }
    }
})

app.post("/masterOverride", async (req, res) => {
    let {authKey, eventsNew, sessionsNew} = req.body;
    if (!authKey || !eventsNew || !sessionsNew) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    if (authKey !== masterKey) {
        return res.status(401).json({error: "Invalid auth query parameter"});
    }

    cacheCities();

    events = eventsNew;
    sessions = sessionsNew;

    sendDataToSlack();
    return res.status(200).json({ message: "Override successful and state backup triggered." });
});

app.post("/forceCache", async (req, res) => {
    let {authKey} = req.body;
    if (authKey === masterKey) {
        cacheCities();
        return res.status(200).json({message: "Cached"});
    }
    return res.status(401).json({error: "Missing or invalid parameter"});
})

app.post("/genBackup", async (req, res) => {
    let {authKey} = req.body;
    if (authKey !== masterKey) {
        return res.status(400).json({error: "Invalid auth"});
    }
    sendDataToSlack();
    return res.status(200).json({message: "Sent through Slack"});
})

app.post("/createSession", async (req, res) => {
    let {code, cityName} = req.body;
    if (!code || !cityName) {
        return res.status(400).json({error: "Missing parameter(s)"});
    }
    let cityExists = ensureEvent(cityName);
    if (!cityExists) {
        return res.status(400).json({error: "Invalid cityName"});
    }
    const response = await fetch("https://auth.hackclub.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            client_id: clientID,
            client_secret: process.env.CLIENT_SECRET,
            redirect_uri: process.env.REDIRECT,
            code: code,
            grant_type: "authorization_code"
        })
    });

    const data = await response.json();
    if (!response.ok) {
        return res.status(400).json({ error: "OAuth exchange failed", details: data });
    }

    // https://auth.hackclub.com/api/v1/me

    const getInfo = await fetch("https://auth.hackclub.com/api/v1/me", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.access_token}`
        },

    })
    const data2 = await getInfo.json();
    console.log("New session validated for ", data2.identity.primary_email);
    if (data2.identity.verification_status === "ineligible") {
        return res.status(401).json({error: "User must be YSWS eligible"});
    }
    let [eventName, acceptedEmails, liveshareData] = cityExists;
    if (acceptedEmails.indexOf(data2.identity.primary_email) == -1) {
        return res.status(401).json({error: "Email is not accepted for this event: must be added using /addEmail"});
    }

    const generateKey = () => {return crypto.randomBytes(32).toString("hex")}
    const key = generateKey();
    sessions = sessions.filter(e => e.emailAddress !== data2.identity.primary_email);
    sessions.push({
        emailAddress: data2.identity.primary_email,
        cityName: cityName,
        key: key
    })
    console.log("New session validated for ", data2.identity.primary_email);
    return res.status(200).json({emailAddress: data2.identity.primary_email, key: key});
})

app.post("/wipeSessions", async (req, res) => {
    let {authKey} = req.body;
    if (!authKey) {
        return res.status(401).json({error: "Not allowed"});
    }
    sessions = [];
    sendDataToSlack();
    return res.status(200).json({message: "All sessions have been wiped"});
})


// --- Server Startup ---
await cacheCities();
await sendDataToSlack();
const port = process.env.PORT || 3000; 

setInterval(async () => {
    await sendDataToSlack();
    //await cacheCities();
}, 10*1000*60)

app.listen(port, function() {
    console.log(`Jumbotron running on port ${port}`);
});
app.set('trust proxy', 'loopback');