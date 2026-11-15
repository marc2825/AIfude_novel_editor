import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "AIFUDE", short_name: "AIFUDE", description: "日本語の原稿を端末に保存し、選んだ範囲だけAIで推敲するエディタ", lang: "ja", start_url: "/", scope: "/", display: "standalone", background_color: "#fafbf7", theme_color: "#356456",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
