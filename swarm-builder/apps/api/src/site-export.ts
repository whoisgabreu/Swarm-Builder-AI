import JSZip from "jszip";
import { compileSitePage, type SitePlan } from "@swarm/dsl";
import type { SiteProjectRecord } from "./site-store.js";

export const buildSiteZip = async (site: SiteProjectRecord): Promise<Buffer> => {
  if (!site.plan) throw new Error("site has no plan");
  const zip = new JSZip();
  for (const page of site.pages) {
    const spec = site.plan.pages.find((item) => item.slug === page.slug);
    if (!spec || !page.artifact) continue;
    const html = compileSitePage({
      site: site.plan,
      page: spec,
      root: page.artifact,
      mode: "static",
    });
    zip.file(spec.role === "home" ? "index.html" : `${page.slug}.html`, html);
  }
  return zip.generateAsync({ type: "nodebuffer" });
};
