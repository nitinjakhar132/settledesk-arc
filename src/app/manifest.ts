import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SettleDesk",
    short_name: "SettleDesk",
    description: "Money in. Mind at ease.",
    start_url: "/",
    display: "standalone",
    background_color: "#101110",
    theme_color: "#101110",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
