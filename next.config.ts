import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Legacy route redirects ─────────────────────────────────
  // /categories and /catalog were two renderings of one workspace,
  // and /templates became /data-center/blueprints. These are 308s so
  // existing links and bookmarks keep working permanently.
  async redirects() {
    return [
      { source: "/categories", destination: "/data-center", permanent: true },
      { source: "/categories/:id", destination: "/data-center/:id", permanent: true },
      { source: "/catalog", destination: "/data-center", permanent: true },
      {
        source: "/catalog/:id",
        destination: "/data-center/:id?tab=items",
        permanent: true,
      },
      { source: "/templates", destination: "/data-center/blueprints", permanent: true },
      {
        source: "/templates/:id",
        destination: "/data-center/blueprints/:id",
        permanent: true,
      },
      // /blueprints shipped briefly in Phase 1 before the Data Center existed.
      { source: "/blueprints", destination: "/data-center/blueprints", permanent: true },
      {
        source: "/blueprints/:id",
        destination: "/data-center/blueprints/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
