"use client";

import { useEffect } from "react";
import { canOpenNativeQm, NATIVE_QM_URL } from "@/lib/native-qm";
import { trpc } from "@/lib/trpc";

export default function HrmnyChatPage() {
  const session = trpc.auth.session.useQuery();

  useEffect(() => {
    if (canOpenNativeQm(session.data)) {
      window.location.replace(NATIVE_QM_URL);
    }
  }, [session.data]);

  return (
    <main className="p-6 text-sm text-muted" aria-live="polite">
      Opening hrmny AI Assistant…
    </main>
  );
}
