import { serve } from "inngest/next";
import { inngest } from "@/server/inngest/client";
import { inngestFunctions } from "@/server/inngest/functions";

/** Official Inngest App Router bridge. Production activation still requires
 * the signing/event key references and a provider sync of this exact URL. */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions],
});
