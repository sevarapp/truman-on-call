# Truman on Call ⛑️

**Learn first aid by playing.** Ten illustrated campus emergencies, from choking and CPR to stroke, seizures, anaphylaxis and tourniquets, plus real-compression CPR practice with your phone, webcam or a DIY force sensor. Drag the right action onto the right spot before the timer runs out. Content follows the **2025 American Heart Association guidelines** and Red Cross first aid.

TigerHacks 2026 · Health theme · Game Development track

---

## Run it (2 minutes)

```bash
npm install
cp .env.example .env      # fill in whichever keys you have
npm start                 # http://localhost:3000
```

Every integration is optional. Missing keys = that feature quietly switches off, the game still works. Check what's live at `/api/health`.

## Sponsor integrations

| Track | What it does in the game | Where |
|---|---|---|
| **Tiger Data** | Every answer and every single CPR compression is stored as time-series data in hypertables. Two continuous aggregates power a live "Insights" screen: the myths players fall for most, accuracy per emergency, and campus-wide CPR quality (% of compressions in the 100–120/min zone). Plus a leaderboard. | `db/schema.sql`, `/api/event`, `/api/cpr`, `/api/insights`, `/api/leaderboard` |
| **Snowflake API** | Powers **Coach Pulse**, the AI first aid coach, through the Cortex Chat Completions REST API. After a wrong answer, "Ask Coach why" sends the exact mistake so the explanation is personal. | `server.js` → `askSnowflake()` |
| **Solana** | After finishing an emergency, players can record a **verifiable training certificate** on Solana devnet (a Memo transaction with name, skill, stars, guideline version). Anyone can check it on Solana Explorer, and nobody can quietly edit it. | `/api/certificate` |
| **Vultr** | The whole app is deployed on a Vultr Cloud Compute instance (steps below). | this README |
| **ElevenLabs** | Gives Truman a real voice for every line in the game (cached, so the demo doesn't burn credits). | `/api/voice` |
| Gemini (optional) | Set `CHAT_PROVIDER=gemini` to run Coach Pulse on Gemini instead. | `askGemini()` |

## Getting the keys (fast path)

- **Tiger Data:** create a free service at console.cloud.timescale.com → copy the connection string into `DATABASE_URL`. Tables and aggregates are created automatically on first start.
- **Snowflake:** free trial → Settings → Authentication → generate a Programmatic Access Token → `SNOWFLAKE_PAT`. Account identifier from "Connect a tool to Snowflake" → `SNOWFLAKE_ACCOUNT`. If requests are refused, add a network policy exception for the PAT.
- **Solana:** `solana-keygen new -o cert.json`, fund it at faucet.solana.com (devnet), then paste the file's contents (the JSON array) into `SOLANA_SECRET_KEY`. Never use a mainnet key here.
- **ElevenLabs:** Profile → API keys → `ELEVENLABS_API_KEY`. Pick a voice ID from the Voice Library (default is a premade voice).

## Deploy on Vultr

1. Vultr → Deploy → Cloud Compute → Ubuntu 24.04, smallest plan is fine.
2. SSH in, then:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs git
   git clone <your repo> maya && cd maya && npm install
   nano .env        # paste your keys, set PORT=80
   sudo npx pm2 start server.js --name maya && sudo npx pm2 save
   ```
3. Open `http://<server-ip>`. Got a domain (there's a Best Domain Name prize)? Point it at the IP and put Caddy in front for free HTTPS: `sudo apt install caddy`, then a Caddyfile line `yourdomain.tld { reverse_proxy localhost:3000 }` with `PORT=3000`.

## API

| Route | |
|---|---|
| `GET /api/health` | which integrations are live |
| `POST /api/chat` | `{system, messages}` → `{reply}` |
| `POST /api/voice` | `{text}` → mp3 |
| `POST /api/event` | one answer |
| `POST /api/cpr` | `{taps:[epoch ms…]}` → one row per compression |
| `POST /api/session` | finished level |
| `GET /api/leaderboard`, `GET /api/insights` | from Tiger Data |
| `POST /api/certificate` | `{player, level, stars, score}` → Solana tx + explorer URL |

## Honest notes

A practice game, not a certification. Research on serious games for CPR shows outcomes comparable to traditional training, not better; the value is reach and repetition. The game always points players to a hands-on course.

## Real CPR sensing (Best Use of Hardware)

Players can do the CPR round, or the standalone **CPR Lab**, with real compressions on a pillow instead of tapping:

| Source | How it measures | Works on |
|---|---|---|
| 📱 Phone motion | Accelerometer (DeviceMotion). Rate from each compression cycle; **depth estimated** from acceleration amplitude and rate (d ≈ a / ω²). | Phones over HTTPS (iOS asks permission) |
| 📷 Webcam | Tracks vertical motion by matching brightness profiles between frames (sub-pixel), then counts cycles. | Any browser with a camera, HTTPS or localhost |
| 🔌 USB sensor | Force-sensitive resistor under the pillow, read over Web Serial. Build guide in `/hardware`. | Chrome/Edge on a laptop |

All three feed one peak detector (adaptive range + hysteresis), so a detected compression scores exactly like a tap. Each compression is logged to Tiger Data with its `source`, and Live insights compares tapping vs. real compressions. Depth numbers are estimates for practice feedback, not a substitute for a feedback manikin.

## Levels (10)

Bike path (head wound) · Rec field (nosebleed) · Johnston Hall (burn) · Dining hall (choking, 2025 AHA 5+5) · Library (cardiac arrest + CPR + AED) · Residence hall (opioid overdose + naloxone) · The Quad (stroke, BE FAST) · Lecture hall (seizure) · Campus café (anaphylaxis + epinephrine auto-injector) · Engineering lab (severe bleeding + tourniquet, Stop the Bleed).
