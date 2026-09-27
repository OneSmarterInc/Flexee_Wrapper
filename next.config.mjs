import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
