import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite rejects requests whose Host header it doesn't recognise. Reaching
    // the dev server over Tailscale means the Host is the machine's
    // <name>.<tailnet>.ts.net address, which would otherwise come back as
    // "Blocked request. This host is not allowed." The leading dot matches
    // any subdomain, and .ts.net names are only reachable from your tailnet.
    allowedHosts: ['.ts.net'],

    // Fail loudly instead of drifting. By default, if 5173 is busy Vite prints
    // "Port 5173 is in use, trying another one..." and starts on 5174 — while
    // `tailscale serve 5173` carries on pointing at 5173, which answers with a
    // 502 that looks like Tailscale is broken when it isn't.
    port: 5173,
    strictPort: true,

    // Bind IPv4 loopback explicitly. Vite's default is "localhost", which on
    // Node 17+ resolves to ::1 first, so the dev server ends up listening on
    // IPv6 only. `tailscale serve` proxies to http://127.0.0.1:<port> over
    // IPv4, finds nothing there, and returns a 502 that looks like Tailscale
    // is broken. Pinning to 127.0.0.1 keeps it loopback-only — Tailscale is
    // still the only way in from another device.
    host: '127.0.0.1',

    proxy: {
      '/api': {
        // 127.0.0.1, not localhost, for the same reason as `host` above:
        // uvicorn binds 127.0.0.1, and a Node proxy resolving "localhost"
        // tries ::1 first.
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
        changeOrigin: true,
      },
    },
  },
})