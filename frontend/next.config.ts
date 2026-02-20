import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "path";

// Load .env from monorepo root so NEXT_PUBLIC_* vars are available
dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default nextConfig;
