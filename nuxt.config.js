// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt',
    '@vercel/analytics/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2026-06-30',

  runtimeConfig: {
    public: {
      posthog: {
        projectToken: process.env.NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
        host: process.env.NUXT_PUBLIC_POSTHOG_HOST
      }
    }
  },

  nitro: {
    vercel: {
      functions: {
        // Porkbun's bulk pricing endpoint alone can take ~19s to respond;
        // the default 10s Vercel function limit kills the request before it returns.
        maxDuration: 30
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
