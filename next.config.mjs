import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Keep @/ imports working in the production bundler as well as TypeScript.
    config.resolve.alias["@"] = path.join(projectRoot, "src");
    return config;
  },
};

export default nextConfig;
