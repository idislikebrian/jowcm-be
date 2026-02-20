# JOWCM Hotline Backend

**Raw Hotline MVP — Phase 1**

A voicemail hotline that transforms caller voices into a radio stream. Call → Record → SMS confirmation → Stream.

## How It Works

1. **Inbound Call** — Twilio voice webhook answers
2. **Recording** — Caller leaves up to 60 seconds of audio
3. **Processing** — Audio downloads, voice number assigned, saved to DB
4. **SMS** — Caller receives confirmation: "You are Voice #17. Your message enters the stream in 5 minutes."
5. **Stream** — Audio file copied to Azurecast watch folder for broadcast

## Stack

- **Runtime:** Node.js 20+ + Express + TypeScript
- **Database:** PostgreSQL
- **Storage:** Local filesystem (`/var/voicemails/`)
- **Telephony:** Twilio
- **Streaming:** Azurecast (via watch folder)

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/idislikebrian/jowcm-be.git
cd jowcm-be
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in:

```env
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/jowcm_hotline

# Twilio (from console.twilio.com)
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+16016887433
TWILIO_WEBHOOK_SECRET=xxx

# Azurecast (from your station admin)
AZURECAST_WATCH_FOLDER=/var/azuracast/stations/YOURSTATION/media/

# Deployment
PUBLIC_BASE_URL=https://journalingoutdoorswouldcureme.live
VOICEMAIL_STORAGE_PATH=/var/voicemails
```

### 3. Database Setup

```bash
# Create database
createdb jowcm_hotline

# Run schema
psql jowcm_hotline < src/db/schema.sql
```

**Schema includes:**
- `voicemails` table — stores call records
- `meta` table — global voice counter (starts at 0)

### 4. Build & Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### 5. Health Check

```bash
curl https://yourdomain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "checks": {
    "db": true,
    "twilio": true,
    "storage": true
  },
  "timestamp": "2026-02-20T..."
}
```

## Twilio Configuration

In your [Twilio Console](https://console.twilio.com):

1. **Phone Number** → Voice & Fax → Webhook
2. Set **A call comes in** webhook to:
   - URL: `https://yourdomain.com/voice`
   - Method: POST
3. **HTTP POST** to `https://yourdomain.com/recording-complete` happens automatically after recording

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/voice` | POST | Returns TwiML (prompt + record) |
| `/recording-complete` | POST | Processes recording, sends SMS, queues audio |
| `/health` | GET | System status check |

## File Structure

```
src/
├── index.ts              # Express server + health checks
├── routes/
│   ├── voice.ts         # TwiML prompt + record
│   └── recording.ts     # Download, counter, DB, SMS, Azurecast
├── services/
│   ├── twilio.ts        # SMS sender
│   ├── azurecast.ts     # File drop to radio
│   └── storage.ts       # Audio download
├── db/
│   ├── client.ts        # PostgreSQL connection
│   └── schema.sql       # Table definitions
└── utils/
    └── validateTwilio.ts # Webhook signature validation
```

## Production Deployment

### Requirements

- Node.js 20+
- PostgreSQL 14+
- ffmpeg (for future phases)
- HTTPS endpoint (Twilio requires SSL)

### VPS Setup (DigitalOcean)

```bash
# Create storage directory
sudo mkdir -p /var/voicemails
sudo chown -R $(whoami):$(whoami) /var/voicemails

# PM2 for process management
npm install -g pm2
pm2 start dist/index.js --name jowcm-hotline
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name journalingoutdoorswouldcureme.live;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio number (+1...) |
| `TWILIO_WEBHOOK_SECRET` | No | For signature validation |
| `AZURECAST_WATCH_FOLDER` | Yes | Path to station media folder |
| `PUBLIC_BASE_URL` | Yes | Your HTTPS domain |
| `VOICEMAIL_STORAGE_PATH` | No | Local storage path (default: ./voicemails) |

## How It Was Built

This MVP was built by 3 parallel sub-agents using the minimax/M2.1 model:

1. **Agent 1 (Architect)** — Infrastructure, TypeScript setup, DB schema
2. **Agent 2 (Core Dev)** — Voice webhook, recording handler, atomic counter
3. **Agent 3 (Integrator)** — Azurecast file drop, SMS confirmation, health checks

Total build time: ~10 minutes. All commits at [github.com/idislikebrian/jowcm-be](https://github.com/idislikebrian/jowcm-be)

## Phase 1 Definition of Done

- [x] Inbound call triggers recording
- [x] Recording completes and saves to VPS
- [x] Global voice counter increments atomically
- [x] SMS confirmation sent with correct voice number
- [x] Audio file appears in Azurecast stream
- [x] `/health` endpoint returns 200
- [x] All code committed to GitHub

## Next Phases (Future)

- **Phase 2:** Streak tracking + caller identity
- **Phase 3:** Generative artifacts from audio
- **Phase 4:** Public archive page
- **Phase 5:** Virality layer (shares, social)
- **Phase 6:** Advanced signal processing

## License

Private — Journaling Outdoors Would Cure Me project

## Contact

For issues: Open a GitHub issue or ping @june---nbeta on Farcaster/BlueSky
