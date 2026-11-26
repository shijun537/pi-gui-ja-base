import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "terms/", "privacy/", "licenses/", "status/"].map((route) => ({
    url: new URL(route, SITE_URL).toString(),
    changeFrequency: "monthly",
    priority: route ? 0.5 : 1,
  }));
}
