/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/Node-only packages out of the client & server bundles.
  serverExternalPackages: ["firebase-admin", "exceljs"],
  // No ESLint config wired up yet; keep it from blocking builds. TS checks stay on.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
