import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/Shell";
import { capabilitySnapshot } from "@/lib/env";
import { getPrimaryBrand } from "@/server/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const brand = await safeBrand();
  if (!brand) redirect("/onboarding");

  const caps = capabilitySnapshot();
  const capabilities = [
    { label: `Database · ${caps.database.driver}`, live: true },
    { label: `Model · ${caps.llm.via}`, live: caps.llm.configured },
    { label: "Video generation", live: caps.video.configured },
    { label: "Voice & music", live: caps.tts.configured },
    { label: caps.youtube.canPublish ? "YouTube posting" : "YouTube · dry run", live: caps.youtube.canPublish },
  ];

  return (
    <DashboardShell brandName={brand.name} capabilities={capabilities}>
      {children}
    </DashboardShell>
  );
}

/** The dashboard must not 500 on a machine whose database was never migrated. */
async function safeBrand() {
  try {
    return await getPrimaryBrand();
  } catch {
    return null;
  }
}
