import type { Metadata } from "next";

import { Onboarding } from "@/components/onboarding/Onboarding";

export const metadata: Metadata = {
  title: "Get started",
  description:
    "Paste your website. We read it, cast your creators and make a real video — before we ask you for anything.",
};

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <Onboarding />;
}
