import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const socket = req.socket as typeof req.socket & { encrypted?: boolean }
            const forwardedForHeader = req.headers["x-forwarded-for"]
            const forwardedFor = Array.isArray(forwardedForHeader)
              ? forwardedForHeader[0]
              : forwardedForHeader || socket.remoteAddress || ""
            const realIp = Array.isArray(forwardedFor)
              ? forwardedFor[0]
              : String(forwardedFor).split(",")[0]?.trim() || socket.remoteAddress || ""

            if (forwardedFor) {
              proxyReq.setHeader("X-Forwarded-For", forwardedFor)
            }
            if (realIp) {
              proxyReq.setHeader("X-Real-IP", realIp)
            }

            const protocol = socket.encrypted ? "https" : "http"
            proxyReq.setHeader("X-Forwarded-Proto", protocol)
            if (req.headers.host) {
              proxyReq.setHeader("X-Forwarded-Host", req.headers.host)
            }
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
