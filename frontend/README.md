# Amina Stays — web app

Next.js 16 (App Router) guest site, host console and Demo Lab. See the [root README](../README.md) for the whole project and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the design.

```bash
npm install
npm run dev        # http://localhost:3000 — proxies /api, /at, /admin, /media to Django (BACKEND_URL, default http://127.0.0.1:8000)
npm run build      # production build (output: standalone, see Dockerfile)
npm run lint
npx tsc --noEmit
```

| Path | |
|---|---|
| `src/app/(site)` | Guest pages: home/search, `stays/[slug]`, `book/[slug]`, `trips`, `trips/[ref]`, `messages`, `wishlists`, `account`, `help`, `privacy`, `login`, `demo` |
| `src/app/host` | Host console (Today, calendar, reservations, inbox, tasks, kitchen, listings, guests, messaging, reviews, insights, payments, safety, channels, settings) |
| `src/app/pay/card/[token]` | Hosted card checkout used in demo mode |
| `src/components/ui` | Design-system primitives (buttons, inputs, dialogs, overlays, badges…) |
| `src/components/site` | Guest views |
| `src/components/host` | Console shell and pages (`ops/`, `biz/`) |
| `src/components/demo` | Demo Lab: SMS, USSD and voice simulators, time machine |
| `src/lib` | API client (same-origin + CSRF), types, formatting |

Conventions: pages are thin server components; anything reading `params` or `useSearchParams` is wrapped in `<Suspense>` (required by `cacheComponents`); data fetching is client-side with TanStack Query; design tokens live in `src/app/globals.css`.
