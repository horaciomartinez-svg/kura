/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: [
    '@kura/core',
    'easy-email-core',
    'easy-email-editor',
    'easy-email-extensions',
  ],
}

export default nextConfig
