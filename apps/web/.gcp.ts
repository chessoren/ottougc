import { env } from "@/lib/env";
import { GoogleAuth } from "google-auth-library";

async function token() {
  const auth = new GoogleAuth({ credentials: env.gcpServiceAccount as never, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return (await (await auth.getClient()).getAccessToken()).token!;
}
async function get(url: string, label: string) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
    const t = await r.text();
    console.log(`${r.ok ? "✅" : "❌"} ${label} [${r.status}] ${t.slice(0, 260).replace(/\s+/g, " ")}`);
    return r.ok;
  } catch (e) { console.log(`❌ ${label} → ${(e as Error).message.slice(0,120)}`); return false; }
}
async function main() {
  const p = env.gcpProjectId;
  console.log("projet:", p, "\n");
  await get(`https://cloudbilling.googleapis.com/v1/projects/${p}/billingInfo`, "facturation");
  await get(`https://sqladmin.googleapis.com/v1/projects/${p}/instances`, "Cloud SQL (liste)");
  await get(`https://run.googleapis.com/v2/projects/${p}/locations/europe-west1/services`, "Cloud Run (liste)");
  await get(`https://cloudscheduler.googleapis.com/v1/projects/${p}/locations/europe-west1/jobs`, "Cloud Scheduler (liste)");
  await get(`https://serviceusage.googleapis.com/v1/projects/${p}/services?filter=state:ENABLED&pageSize=200`, "APIs activées");
  process.exit(0);
}
main();
