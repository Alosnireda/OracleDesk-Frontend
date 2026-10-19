import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OracleDesk",
    short_name: "OracleDesk",
    description: "AI-driven prediction market terminal on Stellar.",
    start_url: "/markets",
    scope: "/",
    display: "standalone",
    background_color: "#f8f9ff", // surface
    theme_color: "#004655", // primary
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
