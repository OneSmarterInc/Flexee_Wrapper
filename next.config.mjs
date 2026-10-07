import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * The three external paths the RapidSims and the retired domain ask for (C2-2 §5).
   *
   * Rewrites, not redirects: these are the addresses printed in sims, in invite links already
   * handed out, and in rapidsims.flexee.org's own forwarding, so they have to answer where they
   * are rather than bounce. The query string is carried by default.
   *
   * A rewrite also keeps the cookie on one origin. rapidsims.flexee.org *redirects* these three
   * here (Addendum B §4) precisely so that a student signs in on learn.flexee.org and nowhere
   * else; the rewrite below is the Wrapper serving its own path under a second name, which is a
   * different thing.
   *
   * `trailingSlash` is deliberately left at its default false. C2-2 §1 requires
   * /api/session-enrolments to answer with no redirect of any kind, and turning trailing slashes on
   * would make Next answer the sims' POST with a 308 that they refuse to follow.
   */
  async rewrites() {
    return [
      { source: "/session.html", destination: "/session" },
      { source: "/open.html", destination: "/open" },
      { source: "/faculty.html", destination: "/faculty" },
    ];
  },
  // Book content is read from disk when CONTENT_STORE=fs (the default). On serverless hosts the
  // content folder must travel inside each function bundle; list it explicitly so a future code
  // change cannot silently drop it. Intake bookkeeping and the answer key stay out.
  outputFileTracingIncludes: { "/**": ["./content/**/*"] },
  outputFileTracingExcludes: {
    "/**": ["./content/_archive/**", "./content/_staging/**", "./content/_intake_report_*", "./content/*/questions.json"],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

export default nextConfig;
