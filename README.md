[//]: # (Initial deployment: 2026-03-13)

# Notion Paywall

A lightweight Express.js paywall that gates a Notion page behind a one-time Stripe payment.
Runs on Docker, deployed behind Traefik with automatic HTTPS via Let's Encrypt.

---

## Architecture

```
Browser → Traefik (HTTPS) → Express app
                                ├── GET  /            Landing page with Notion preview
                                ├── POST /checkout    Create Stripe Checkout Session
                                ├── GET  /success     Post-payment token issuance
                                ├── GET  /content     Full Notion page (auth-gated)
                                └── POST /webhook     Stripe payment events
```

Access control is cookie-based: after payment a `uuid` token is stored in SQLite and set as an `HttpOnly` cookie for 30 days.

---

## Prerequisites

| Tool | Notes |
|------|-------|
| Docker + Docker Compose | v2+ |
| Traefik | Running with `traefik-public` external network, `websecure` entrypoint, and a `letsencrypt` cert resolver |
| Stripe account | With a Product + Price created |
| Notion integration | With the target page shared with the integration |

---

## 1 — Notion Setup

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and create a new integration.
   Copy the **Internal Integration Token** → `NOTION_API_KEY`.
2. Open the Notion page you want to sell, click **···** → **Add connections** → select your integration.
3. Copy the page ID from the URL:
   `https://www.notion.so/My-Page-<PAGE_ID>`
   The `PAGE_ID` is the 32-character hex string at the end.  → `NOTION_PAGE_ID`.

---

## 2 — Stripe Setup

1. In the Stripe Dashboard create a **Product** with a **one-time Price** (e.g. €9.99).
   Copy the **Price ID** (`price_…`) → `STRIPE_PRICE_ID`.
2. Copy your **Secret key** (`sk_live_…`) → `STRIPE_SECRET_KEY`.
3. **Webhook**: in the Dashboard go to *Developers → Webhooks → Add endpoint*.
   - URL: `https://paywall.automatisierer.io/webhook`
   - Events: `checkout.session.completed`, `payment_intent.succeeded`
   Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

> **Testing locally** — use the Stripe CLI to forward events:
> ```bash
> stripe listen --forward-to http://localhost:3000/webhook
> ```
> Use the signing secret printed by the CLI as `STRIPE_WEBHOOK_SECRET` during local dev.

---

## 3 — Server Setup

### 3.1 Clone the repo

```bash
git clone <repo-url> /opt/notion-paywall
cd /opt/notion-paywall
```

### 3.2 Create the `.env` file

```bash
cp .env.example .env
nano .env        # fill in all values
```

### 3.3 Ensure the Traefik network exists

```bash
docker network inspect traefik-public >/dev/null 2>&1 || \
  docker network create traefik-public
```

### 3.4 Build and start

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f paywall
```

The app is now available at **https://paywall.automatisierer.io**.

---

## 4 — Updating

```bash
git pull
docker compose up -d --build
```

The SQLite database is stored in a Docker volume (`paywall-data`) and survives container rebuilds.

---

## 5 — Local Development

```bash
cp .env.example .env
# Fill in STRIPE_SECRET_KEY, NOTION_API_KEY, NOTION_PAGE_ID at minimum.
# Set BASE_URL=http://localhost:3000
# Use stripe CLI for webhook forwarding (see above).

npm install
npm run dev      # nodemon auto-reload
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BASE_URL` | ✅ | Public URL of the site (no trailing slash) |
| `PORT` | | Port the server listens on (default: `3000`) |
| `NODE_ENV` | | Set to `production` in Docker |
| `NOTION_API_KEY` | ✅ | Notion integration token |
| `NOTION_PAGE_ID` | ✅ | 32-char Notion page ID |
| `PREVIEW_BLOCKS` | | Number of blocks shown in the free preview (default: `5`) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key |
| `STRIPE_PRICE_ID` | ✅ | Stripe Price ID for the product |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `STRIPE_PRICE_DISPLAY` | | Price label on the buy button (default: `€9.99`) |
| `PRODUCT_NAME` | | Hero headline (falls back to Notion page title) |
| `CONTENT_CACHE_TTL_MS` | | Notion content cache in ms (default: `300000` = 5 min) |
| `DB_PATH` | | SQLite file path (default: `./data/paywall.db`) |

---

## File Structure

```
notion-paywall/
├── src/
│   ├── index.js          # Express app bootstrap
│   ├── db.js             # SQLite helpers (better-sqlite3)
│   ├── notion.js         # Notion API client + HTML renderer
│   └── routes/
│       ├── index.js      # GET  /  — landing page
│       ├── checkout.js   # POST /checkout
│       ├── webhook.js    # POST /webhook
│       ├── success.js    # GET  /success
│       └── content.js    # GET  /content (auth-gated)
├── views/
│   ├── landing.html
│   ├── success.html
│   └── content.html
├── public/
│   └── style.css
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Security Notes

- Stripe webhook signatures are verified with `stripe.webhooks.constructEvent` — raw body parsing is applied only to `/webhook`.
- Access tokens are `HttpOnly`, `Secure`, `SameSite=Lax` cookies — not accessible to JavaScript.
- The SQLite database is never exposed to the web; it lives in a Docker volume.
- Notion content is served server-side; the full Notion API key is never sent to the browser.
- HSTS and security headers are applied via Traefik middleware labels.
