"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/primitives";

/**
 * A button that triggers an agent run.
 *
 * Agent runs take minutes, so the button reports what is happening rather than
 * spinning silently — an operator who cannot tell whether a click registered
 * clicks again, and a second fleet plan is not a harmless duplicate.
 */
export function RunAction({
  action,
  label,
  running,
  variant = "secondary",
  size = "sm",
}: {
  action: () => Promise<{ ok: boolean; message: string }>;
  label: string;
  running: string;
  variant?: "primary" | "secondary" | "ghost" | "dark";
  size?: "sm" | "md" | "lg";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const r = await action();
            setResult(r);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : null}
        {pending ? running : label}
      </Button>
      {result ? (
        <span className={`text-2xs ${result.ok ? "text-win" : "text-kill"}`}>{result.message}</span>
      ) : null}
    </div>
  );
}
