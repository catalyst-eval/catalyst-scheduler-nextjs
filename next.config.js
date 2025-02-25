/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@sendgrid/mail', 'google-auth-library'],
  experimental: {
    serverComponentsExternalPackages: ['@sendgrid/mail', 'google-auth-library']
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        '@sendgrid/mail',
        'google-auth-library'
      )
    }
    return config
  },
  env: {
    VERCEL_ENV: process.env.VERCEL_ENV
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-IntakeQ-Signature' }
        ]
      }
    ]
  }
}