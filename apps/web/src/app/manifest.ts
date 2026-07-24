import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "hrmny OS",
    short_name: "hrmny OS",
    description: "Creative Harmony employee operating system",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F0E8",
    theme_color: "#C7702E",
    icons: [
      {
        src: "/icons/hrmny-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/hrmny-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
