import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig(({ mode }) => {
  const isTest = mode === 'test'

  return {
    resolve: {
      tsconfigPaths: true,
      alias: isTest
        ? {
            'cloudflare:email': fileURLToPath(
              new URL('./test/support/cloudflare-email-shim.ts', import.meta.url),
            ),
          }
        : undefined,
    },
    plugins: [
      ...(isTest ? [] : [devtools(), cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart()]),
      tailwindcss(),
      viteReact(),
    ],
  }
})

export default config
