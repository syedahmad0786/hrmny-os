"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { createTrpcClient, trpc } from "@/lib/trpc";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTrpcClient());
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let principal: string | null | undefined;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (principal !== undefined && next !== principal) {
        // Cancel old reads before resetting cached private data for the new identity.
        void queryClient.cancelQueries().then(() => queryClient.resetQueries());
      }
      principal = next;
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
