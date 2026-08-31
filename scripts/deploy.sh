#!/usr/bin/env bash
#
# Put the fleet on Google Cloud.
#
#   Cloud SQL        the state: runs, memory, strategies, verdicts
#   Cloud Run        the worker: agents, generation, rendering, publishing
#   Cloud Scheduler  the clock: when each of those happens
#
# Idempotent. Run it again after any change; it updates in place rather than
# creating a second copy of anything.
#
#   ./scripts/deploy.sh
#
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0306342927}"
REGION="${OTTOUGC_REGION:-europe-west1}"
SERVICE="ottougc"
INSTANCE="ottougc"
DB_NAME="ottougc"
DB_USER="ottougc"
BUCKET="${GCS_BUCKET:-${PROJECT}-ottougc-assets}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "Project ${PROJECT}, region ${REGION}"
gcloud config set project "${PROJECT}" >/dev/null
gcloud config set run/region "${REGION}" >/dev/null

say "Enabling the services this needs"
gcloud services enable \
  sqladmin.googleapis.com run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com storage.googleapis.com \
  texttospeech.googleapis.com speech.googleapis.com >/dev/null

# ── The database ───────────────────────────────────────────────────────────
CONNECTION_NAME="$(gcloud sql instances describe "${INSTANCE}" --format='value(connectionName)')"
say "Cloud SQL: ${CONNECTION_NAME}"

# Cloud Run reaches Cloud SQL over a unix socket rather than a host and port.
# There is no network path to open and no IP to allowlist, which is why the
# instance can stay closed to the internet.
DB_PASSWORD="${OTTOUGC_DB_PASSWORD:?set OTTOUGC_DB_PASSWORD to the database password}"
SOCKET_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

# ── The worker ─────────────────────────────────────────────────────────────
say "Building and deploying the worker"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "${RUNTIME_SA:-cursor@${PROJECT}.iam.gserviceaccount.com}" \
  --add-cloudsql-instances "${CONNECTION_NAME}" \
  --memory 4Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT}" \
  --set-env-vars "GOOGLE_CLOUD_GEMINI_LOCATION=global" \
  --set-env-vars "GCS_BUCKET=${BUCKET}" \
  --set-env-vars "GENERATED_DIR=/tmp/generated" \
  --set-env-vars "DATABASE_URL=${SOCKET_URL}" \
  --set-env-vars "CRON_SECRET=${CRON_SECRET:?set CRON_SECRET}" \
  --set-env-vars "DAILY_GENERATION_BUDGET_USD=${DAILY_GENERATION_BUDGET_USD:-50}" \
  --set-env-vars "DRY_RUN_PUBLISHING=${DRY_RUN_PUBLISHING:-true}"
# No service-account key anywhere in that command. The container authenticates
# as ${RUNTIME_SA:-cursor@...} through the metadata server, so there is no
# private key in an environment variable, a log line or a revision description.

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
say "Live at ${URL}"

# ── The clock ──────────────────────────────────────────────────────────────
#
# One instance, so only one render runs at a time. `--max-instances 1` above and
# these schedules together are what keep two agents from rendering at once on
# two vCPUs.
say "Scheduling the fleet"

schedule() {
  local name="$1" cron="$2" path="$3" description="$4"
  local args=(
    --location "${REGION}"
    --schedule "${cron}"
    --time-zone "Europe/Paris"
    --uri "${URL}/api/cron/${path}"
    --http-method GET
    --headers "Authorization=Bearer ${CRON_SECRET}"
    --attempt-deadline 1800s
    --description "${description}"
  )
  if gcloud scheduler jobs describe "${name}" --location "${REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${name}" "${args[@]}" >/dev/null
    echo "  updated  ${name}  ${cron}"
  else
    gcloud scheduler jobs create http "${name}" "${args[@]}" >/dev/null
    echo "  created  ${name}  ${cron}"
  fi
}

# Creators make the day's video early: it has to be written, generated, checked
# and rendered well before its publishing slot. A render that fails at 18:25 for
# an 18:30 slot is a day lost.
schedule ottougc-produce "0 7 * * *"    produce "Each creator makes today's video"
schedule ottougc-publish "*/30 * * * *" publish "Post anything whose slot has come"
schedule ottougc-ingest  "0 * * * *"    ingest  "Pull metrics, apply the decision grid"
schedule ottougc-analyse "30 23 * * *"  analyse "Interpret the day, write lessons to memory"
schedule ottougc-review  "0 9 * * 1"    review  "The manager reviews every channel"
schedule ottougc-warm    "0 3 * * *"    warm    "Advance the warming ramp"

say "Done"
echo "  service    ${URL}"
echo "  database   ${CONNECTION_NAME}"
echo "  scheduler  gcloud scheduler jobs list --location ${REGION}"
echo
echo "Trigger one by hand:"
echo "  gcloud scheduler jobs run ottougc-produce --location ${REGION}"
