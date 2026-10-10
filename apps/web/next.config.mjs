/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@kura/core',
    'easy-email-core',
    'easy-email-editor',
    'easy-email-extensions',
  ],
}

export default nextConfig
