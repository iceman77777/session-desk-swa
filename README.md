# Session Desk — Azure Static Web App

Live, shared **Q&A + session feedback** for *The One that is built on Trust* (London AI, 15 September 2026).
Everyone who signs in sees the same questions, votes and ratings in real time-ish (the page polls every 12 seconds).

## Architecture

| Layer | Technology | Notes |
|------|------------|-------|
| Frontend | Static HTML/CSS/JS (`index.html`) | No build step. Calls the API; gates on sign-in. |
| API | Azure Functions (Node 18, v4 model) in `/api` | Managed functions inside the Static Web App. |
| Database | **Azure Cosmos DB for NoSQL (serverless)** | Two containers, partitioned by `/sessionId`. Created automatically on first write. |
| Auth | Static Web Apps built-in authentication | Microsoft (Entra ID) + GitHub. Any signed-in user can take part. |

**Data model** (Cosmos DB, database `sessiondesk`):
- `questions` — `{ id, sessionId, text, authorName, authorId, voters[], answered, createdAt }` — votes are the length of `voters`, so each user counts once.
- `feedback` — `{ id: "<sessionId>::<userId>", sessionId, userId, rating, tags[], comment, createdAt }` — one row per user per session (upserted).

The agenda (the three sessions) is static in `index.html`; only the live data lives in the database.

## API

All endpoints require an authenticated user (enforced by `staticwebapp.config.json`).

| Method & route | Purpose |
|----------------|---------|
| `GET /api/questions?sessionId=` | List questions (with `votes`, `hasVoted`, `answered`) |
| `POST /api/questions` | Add a question `{ sessionId, text, name }` |
| `POST /api/questions/vote` | Toggle your upvote `{ id, sessionId }` |
| `POST /api/questions/answer` | Toggle answered `{ id, sessionId }` — **organizer role only** |
| `GET /api/feedback?sessionId=` | Aggregates (average, distribution, tag tally) + your submission |
| `POST /api/feedback` | Submit/replace your rating `{ sessionId, rating, tags[], comment }` |

---

## Deploy (Azure Portal — recommended, ~10 min)

### 1. Push this folder to a GitHub repo
```bash
cd session-desk-swa
git init && git add . && git commit -m "Session Desk SWA"
git branch -M main
git remote add origin https://github.com/<you>/session-desk-swa.git
git push -u origin main
```

### 2. Create the Cosmos DB account
Azure Portal → **Create resource → Azure Cosmos DB → Azure Cosmos DB for NoSQL**.
- **Capacity mode: Serverless** (cheapest for event traffic).
- Pick a region close to your attendees (e.g. UK South).
- After it deploys: **Settings → Keys → copy the *Primary Connection String***.
- You don't need to create the database/containers by hand — the API creates them on first use.

### 3. Create the Static Web App
Azure Portal → **Create resource → Static Web App**.
- Plan: **Free** is fine to start.
- **Deployment: GitHub** → authorize → pick your repo and the `main` branch.
- Build presets: **Custom**, with:
  - **App location:** `/`
  - **API location:** `api`
  - **Output location:** *(leave blank)*
- Create. Azure adds a GitHub Actions workflow and the deploy token secret automatically, then builds. Watch it under the repo's **Actions** tab.

### 4. Point the API at Cosmos DB
Static Web App → **Settings → Environment variables** (Application settings) → add:
| Name | Value |
|------|-------|
| `COSMOS_CONNECTION_STRING` | *(the primary connection string from step 2)* |
| `COSMOS_DATABASE` | `sessiondesk` |

Save (this restarts the API).

### 5. Turn on the login providers
Static Web Apps needs an identity provider registered. See **Authentication** below. For a quick first test you can try the pre-configured providers at `/.auth/login/github`; for production, register your own (recommended).

### 6. Open your site
Your URL looks like `https://<name>.azurestaticapps.net`. You'll get the sign-in screen; after signing in, the Q&A loads.

---

## Authentication

The frontend sends people to `/.auth/login/aad` (Microsoft) and `/.auth/login/github` (GitHub). To register your own providers (recommended), add this to `staticwebapp.config.json` and set the matching secrets as application settings:

```jsonc
"auth": {
  "identityProviders": {
    "azureActiveDirectory": {
      "registration": {
        "openIdIssuer": "https://login.microsoftonline.com/common/v2.0",
        "clientIdSettingName": "AAD_CLIENT_ID",
        "clientSecretSettingName": "AAD_CLIENT_SECRET"
      }
    },
    "github": {
      "registration": {
        "clientIdSettingName": "GITHUB_CLIENT_ID",
        "clientSecretSettingName": "GITHUB_CLIENT_SECRET"
      }
    }
  }
}
```
- **Microsoft / Entra ID:** Portal → *Microsoft Entra ID → App registrations → New*. Redirect URI (Web): `https://<your-swa>.azurestaticapps.net/.auth/login/aad/callback`. Use `.../common/v2.0` as the issuer to let **any** Microsoft account sign in (personal + work). Create a client secret. Add `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` to app settings.
- **GitHub:** GitHub → *Settings → Developer settings → OAuth Apps → New*. Callback URL: `https://<your-swa>.azurestaticapps.net/.auth/login/github/callback`. Add `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` to app settings.

### Making someone an organizer
Only users with the `organizer` role can mark questions answered. Assign it in the Portal:
Static Web App → **Role management → Invite** → enter the person's details, role `organizer`, send the invite link. Everyone else is automatically `authenticated`.

---

## Run locally

```bash
# 1. API settings
cp api/local.settings.json.example api/local.settings.json
#    put your Cosmos connection string in it

# 2. tools (once)
npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cd ..

# 3. run both together
swa start . --api-location api
```
Then open `http://localhost:4280`. The SWA CLI emulates auth — visit `http://localhost:4280/.auth/login/aad` and it lets you fake a user (you can add the `organizer` role there to test answering).

---

## Cost

- **Cosmos DB serverless** — pay per request unit + storage; a small event costs pennies and scales to zero when idle.
- **Static Web Apps Free** — no cost; includes managed functions and auth. Upgrade to Standard only if you need SLA, more auth control, or higher limits.

## Going further
- **True realtime** (instead of 12s polling): add Azure Web PubSub or SignalR Service and push new questions/votes to clients.
- **Moderation:** add a `hidden` flag + an organizer-only endpoint to remove off-topic questions.
- **Export:** a small `GET /api/export?sessionId=` for organizers to download questions + feedback as CSV after the event.
