import crypto from 'crypto'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow ngrok and other dev tunneling services
  allowedDevOrigins: [
    'https://*.ngrok-free.app',
    'https://*.ngrok.io',
    'https://*.ngrok.dev',
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Enable image optimization for better LCP
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000, // 1 year
  },
  // Enable experimental features for better performance
  experimental: {
    // Increase body parser size limit for API routes
    serverActions: {
      bodySizeLimit: '10mb',
    },
    optimizePackageImports: [
      'lucide-react',
      '@supabase/supabase-js',
      '@supabase/ssr',
      'recharts',
      '@radix-ui/react-select',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tooltip',
      'date-fns', // Date utilities
      'zod', // Validation library
      '@xyflow/react', // Workflow builder
    ],
    // Optimize CSS (Next.js 15+)
    optimizeCss: true,
  },
  // Mark optional native dependencies as external to skip bundling
  serverExternalPackages: [
    'puppeteer',
    'puppeteer-core',
    '@sparticuz/chromium',
    'pyodide',
    'fstream',
    'rimraf'
  ],
  // Turbopack configuration (used by next dev --turbo)
  turbopack: {
    resolveAlias: {
      // Alias fstream's rimraf dependency to the installed version
      'rimraf': 'rimraf',
    },
  },
  // Optimize production builds
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Fix Cross-Origin-Opener-Policy for OAuth popups
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          // Prefetch DNS for external resources
          {
            key: 'Link',
            value: '<https://fonts.googleapis.com>; rel=dns-prefetch',
          },
          // Prevent caching of sensitive/personalized HTML pages
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
              : 'no-cache, no-store, must-revalidate, private',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          // Security Headers
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              // Prevent framing (clickjacking protection)
              "frame-ancestors 'none'",
              // Restrict base URI
              "base-uri 'self'",
              // Restrict form submissions
              "form-action 'self'",
              // Script sources - 'unsafe-inline' needed for Next.js, 'unsafe-eval' needed for some libs
              // In production, consider using nonces instead
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com https://www.googletagmanager.com https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com",
              "script-src-elem 'self' 'unsafe-inline' https://js.stripe.com https://maps.googleapis.com https://www.googletagmanager.com https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com",
              // Style sources
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Font sources
              "font-src 'self' https://fonts.gstatic.com data:",
              // Image sources
              "img-src 'self' data: blob: https: http:",
              // Connect sources (API endpoints, WebSockets)
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://maps.googleapis.com https://api.resend.com https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://apis.google.com https://www.googleapis.com",
              // Object sources (plugins)
              "object-src 'none'",
              // Child/frame sources
              "child-src 'self' https://js.stripe.com https://docs.google.com https://drive.google.com",
              // Worker sources
              "worker-src 'self' blob:",
              // Manifest
              "manifest-src 'self'",
              // Upgrade insecure requests in production
              ...(isDev ? [] : ["upgrade-insecure-requests"]),
            ].filter(Boolean).join('; '),
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'payment=()',
              'usb=()',
              'magnetometer=()',
              'gyroscope=()',
              'accelerometer=()',
              // 'ambient-light-sensor=()' removed - no longer recognized by browsers
              'autoplay=()',
              'encrypted-media=()',
              'picture-in-picture=()',
              'sync-xhr=()',
              'midi=()',
              'display-capture=()',
              'fullscreen=(self)',
            ].join(', '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // Additional cache control for proxy servers
          ...(isDev ? [
            {
              key: 'Surrogate-Control',
              value: 'no-store',
            },
          ] : []),
        ],
      },
      // Specific caching for images
      {
        source: '/_next/image(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
      // Specific caching for static assets
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
      // Caching for public static assets (images, SVGs, fonts)
      {
        source: '/integrations/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
      {
        source: '/:path*.(svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    // Suppress the webpack cache warning about large strings
    config.infrastructureLogging = {
      level: 'error',
    }

    // Alternative: disable the specific warning
    if (!config.ignoreWarnings) {
      config.ignoreWarnings = []
    }
    config.ignoreWarnings.push(/Serializing big strings/)

    // Handle Supabase Realtime critical dependency warnings
    config.ignoreWarnings.push(/Critical dependency: the request of a dependency is an expression/)

    // Suppress warning for optional twilio dependency (used only when configured)
    config.ignoreWarnings.push(/Module not found: Can't resolve 'twilio'/)

    // Configure webpack to handle dynamic imports in Supabase Realtime
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }

      // Add chunk naming for better debugging
      config.output.chunkFilename = 'static/chunks/[name].[contenthash].js'

      // Add runtime chunk optimization
      config.optimization = {
        ...config.optimization,
        runtimeChunk: 'single',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            framework: {
              chunks: 'all',
              name: 'framework',
              test: /(?<!node_modules.*)[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-subscription)[\\/]/,
              priority: 40,
              enforce: true,
            },
            lib: {
              test(module) {
                return module.size() > 160000 &&
                  /node_modules[/\\]/.test(module.identifier())
              },
              name(module) {
                const hash = crypto.createHash('sha1')
                hash.update(module.identifier())
                return hash.digest('hex').substring(0, 8)
              },
              priority: 30,
              minChunks: 1,
              reuseExistingChunk: true,
            },
            commons: {
              name: 'commons',
              minChunks: 2,
              priority: 20,
            },
            shared: {
              name(module, chunks) {
                return crypto
                  .createHash('sha1')
                  .update(chunks.reduce((acc, chunk) => acc + chunk.name, ''))
                  .digest('hex')
                  .substring(0, 8)
              },
              priority: 10,
              minChunks: 2,
              reuseExistingChunk: true,
            },
          },
        },
      }
    }

    return config
  },
}

export default nextConfig
