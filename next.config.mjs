/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  experimental: {
    externalDir: true
  },
  async headers() {
    return [{
      source: "/pdp-maker/:path*",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://baegotint.com https://www.baegotint.com" }],
    }];
  },
};

export default nextConfig;
