/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/portal/:path*",
        destination: "https://hrmny-os.vercel.app/client-preview",
        permanent: false,
      },
      {
        source: "/:path*",
        destination: "https://hrmny-os.vercel.app/:path*",
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
