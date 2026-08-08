// https://nuxt.com/docs/api/configuration/nuxt-config
import { execSync } from 'node:child_process'

/** Vercel checks out full git history at build time, so this works both locally and in production. */
function readBuildInfo() {
  try {
    return {
      sha: execSync('git rev-parse --short HEAD').toString().trim(),
      timestamp: execSync('git log -1 --format=%cI').toString().trim()
    }
  } catch {
    return { sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown', timestamp: '' }
  }
}
const buildInfo = readBuildInfo()

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
      },
      build: buildInfo
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
  },

  app: {
    head: {
      script: [
        {
          innerHTML: `(function(w,d,t,u,o){w[u]=w[u]||[],o.ts=(new Date).getTime();var n=d.createElement(t);n.src="https://bat.bing.net/bat.js?ti="+o.ti+("uetq"!=u?"&q="+u:""),n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&"loaded"!==s&&"complete"!==s||(o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad"),n.onload=n.onreadystatechange=null)};var i=d.getElementsByTagName(t)[0];i.parentNode.insertBefore(n,i)})(window,document,"script","uetq",{ti:"343264315",enableAutoSpaTracking:true});`,
          type: 'text/javascript'
        }
      ]
    }
  }
})
