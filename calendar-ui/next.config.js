const path = require('path')

// Single env file at repo root (LifeSynced/.env.local) — load before Next.js uses env
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig

