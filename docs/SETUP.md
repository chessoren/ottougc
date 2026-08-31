# Setup

> Every box ticked here fills one variable in `.env.local`. Nothing else is needed:
> the app starts with stand-ins and switches to real generation the moment a key
> appears.

---

## Read this first — the real bottleneck

**The YouTube upload quota is the constraint, not the AI.**

| Fact | Value | Source |
| :--- | :--- | :--- |
| Default quota per Google Cloud project | **10,000 units / day** | YouTube Data API docs |
| Cost of one `videos.insert` | **1,600 units** | same |
| ⇒ Uploads possible per day, per project | **6 videos / day** | 6 × 1,600 = 9,600 |

The target is **450 videos a month** (15 a day). On the default quota you are capped at
**180 a month**, and that cap is **per Google Cloud project**, not per channel.

### Three levers, in priority order

1. **Request a quota extension (free, slow).**
   Form: *YouTube API Services — Audit and Quota Extension Form*, from
   `Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas → Edit Quotas`.
   Typical wait: **2 to 8 weeks**. Google asks for a demo video, a privacy policy URL,
   and a justification for the volume.
   👉 **File it today.** It's the critical path, and the code will be ready long before
   the answer arrives.

2. **Project sharding (works immediately).**
   Each project gets its own 10,000 units. `n` projects means `6n` uploads a day.
   OttoUGC keeps a **pool of credentials** (`api_projects`) and routes each upload to
   whichever project has the most quota left, accounting for units in the database and
   failing over automatically on `quotaExceeded`.
   👉 Create **three projects** to start: 18 uploads a day, 540 a month.

3. **Reduce the cost of reading.** Metrics are read with `videos.list` (1 unit), never
   `search.list` (100 units). The code **never** calls `search.list` on channels we own —
   it reads the uploads playlist instead. Already implemented.

### Second constraint: OAuth verification

The YouTube scopes are **sensitive**. While the consent screen is in *Testing*:
- a maximum of **100 test users**,
- **refresh tokens expire after seven days**, so the creators lose channel access weekly.

To lift that, move the app to *In production* and submit for Google verification (a few
days to several weeks). The code handles re-authentication cleanly and warns in the
dashboard, but **start the verification today too**.

> For your own use, add your account as a test user and everything works immediately.
> Verification only blocks third-party customers.

---

## 1. Google Cloud project

1. https://console.cloud.google.com/ → **Create Project**
   - Nom : `ottougc-prod` — note le **Project ID** (ex. `ottougc-prod-471203`).
2. Lie un **compte de facturation** (obligatoire pour Vertex AI et Lyria).
3. Pick one region and keep it everywhere: **`us-central1`** — the only one where Imagen,
   Lyria and text-to-speech are all available at once.

## 2. APIs to enable

Paste this into **Cloud Shell** (the terminal icon at the top right of the console) — that's
plus rapide que de cliquer 17 fois :

```bash
gcloud config set project TON_PROJECT_ID

gcloud services enable \
  aiplatform.googleapis.com \
  generativelanguage.googleapis.com \
  youtube.googleapis.com \
  youtubeanalytics.googleapis.com \
  youtubereporting.googleapis.com \
  texttospeech.googleapis.com \
  speech.googleapis.com \
  storage.googleapis.com \
  storage-component.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  translate.googleapis.com \
  videointelligence.googleapis.com
```

| API | Why it's needed |
| :--- | :--- |
| `aiplatform` | Vertex AI: the agents' model, Imagen for character reference images, Lyria for music |
| `generativelanguage` | Gemini Omni Flash for video, and the agents' model via AI Studio |
| `youtube` | Posting, comments, reading playlists |
| `youtubeanalytics` | Second-by-second retention, watch time, traffic sources — the decision engine |
| `youtubereporting` | Daily bulk reports (zero quota — how reading scales) |
| `texttospeech` | Chirp 3 HD voiceover, normalised to −14 LUFS |
| `speech` | Word-level timestamps for kinetic captions |
| `storage` | Asset bucket: footage and final MP4s |
| `run` + `cloudbuild` + `artifactregistry` | Remotion render workers |
| `cloudscheduler` + `cloudtasks` | The daily cron and the job queue |
| `secretmanager` | Customers' YouTube refresh tokens |
| `translate` | Multi-market localisation (later) |
| `videointelligence` | Vision QA: artefact and policy detection before posting |

## 3. Service account (Vertex AI, Storage, TTS, STT)

```bash
PROJECT_ID=$(gcloud config get-value project)

gcloud iam service-accounts create ottougc-engine \
  --display-name="OttoUGC Generation Engine"

SA="ottougc-engine@${PROJECT_ID}.iam.gserviceaccount.com"

for ROLE in \
  roles/aiplatform.user \
  roles/storage.objectAdmin \
  roles/secretmanager.secretAccessor \
  roles/cloudtranslate.user \
  roles/run.invoker \
  roles/cloudtasks.enqueuer
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA}" --role="$ROLE" --condition=None
done

gcloud iam service-accounts keys create ~/ottougc-sa.json --iam-account="$SA"
cat ~/ottougc-sa.json
```

➡️ **Copy the whole JSON** into `GOOGLE_SERVICE_ACCOUNT_JSON`, or save it to
`apps/web/.gcp-service-account.json` (already gitignored).

### Storage bucket

```bash
gcloud storage buckets create gs://${PROJECT_ID}-ottougc-assets --location=us-central1
gcloud storage buckets update gs://${PROJECT_ID}-ottougc-assets --uniform-bucket-level-access
```

## 4. OAuth client (so users can connect their channels)

A service account **cannot** upload to somebody's channel. An OAuth flow where the user
authorises OttoUGC is mandatory, and that is what is built.

1. `APIs & Services → OAuth consent screen`
   - User type: **External**
   - App name: `OttoUGC`
   - Support and developer email: yours
   - **Scopes** — exactly these:
     ```
     https://www.googleapis.com/auth/youtube.upload
     https://www.googleapis.com/auth/youtube.force-ssl
     https://www.googleapis.com/auth/youtube.readonly
     https://www.googleapis.com/auth/yt-analytics.readonly
     https://www.googleapis.com/auth/userinfo.email
     https://www.googleapis.com/auth/userinfo.profile
     openid
     ```
     (`youtube.force-ssl` is required to post and pin comments.)
   - **Test users**: add your own account, plus any Google account owning the channels
     you want to run.

2. `APIs & Services → Credentials → Create Credentials → OAuth client ID`
   - Type: **Web application**
   - Name: `OttoUGC Web`
   - **Authorized JavaScript origins** :
     ```
     http://localhost:3000
     https://ottougc.com
     ```
   - **Authorized redirect URIs** (both, exactly):
     ```
     http://localhost:3000/api/auth/youtube/callback
     https://ottougc.com/api/auth/youtube/callback
     ```
3. Copy the **Client ID** and **Client Secret**.

## 5. Supabase

1. https://supabase.com/dashboard → **New project**, region **East US (North Virginia)**
   to sit near Vercel `iad1`.
2. `Project Settings → Database → Connection string → URI` :
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (used by the app, serverless-safe)
   - **Direct connection** (port `5432`) → `DIRECT_URL` (used by migrations)
3. `Project Settings → API` : `Project URL`, `anon public`, `service_role`.
4. In the SQL editor, enable pgvector for the knowledge base:
   ```sql
   create extension if not exists vector;
   ```

## 6. The `.env.local` file

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill it in. Anything left empty
puts that module into **stand-in mode** — the app starts and the whole pipeline runs, but
quality control blocks every video containing a stand-in.

---

## Your morning checklist

- [ ] **File the YouTube quota extension form** ← longest lead time, do it first
- [ ] **Submit for OAuth verification** ← same, external delay
- [ ] Create the GCP project and enable the APIs above
- [ ] Create the service account and save the JSON
- [ ] Create the Cloud Storage bucket
- [ ] Create the OAuth client and save the Client ID and Secret
- [ ] Create the Supabase project and save `DATABASE_URL` and `DIRECT_URL`
- [ ] Create two more GCP projects for quota sharding (optional on day one)
