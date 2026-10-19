# SabiShop

**Your shop, in control.** SabiShop is an AI-assisted workflow for neighbourhood retailers to record sales in everyday language, understand stock, answer customer availability questions, and reserve items for collection.

## Current status

This branch contains the first interactive frontend demo. It is intentionally branded as SabiShop with a familiar chat interaction; it is not the official WhatsApp application.

- Responsive retailer/customer demo views
- Seeded Nigerian provision-store catalogue and Naira pricing
- Natural-language sale parsing with a review/confirmation step
- Inventory and gross-profit snapshot updated after confirming a sale
- Threshold-based low-stock alerts
- Customer stock lookup, reservations, and reservation cancellation
- Browser-local persistence for demo data
- Voice typing where the browser supports the Web Speech API
- Supabase client dependency and environment template included for the next integration phase

**Important:** this first demo uses deterministic client-side parsing and browser storage. It is not yet connected to a live LLM or Supabase database. Do not use it as a production ledger.

## Run locally

Requires Node.js compatible with the installed Vite version (Node 20.19+ or 22.12+ recommended).

```bash
npm install
npm run dev
```

Open the URL printed by Vite. To run a production build:

```bash
npm run build
npm run preview
```

## Next implementation milestones

1. Supabase schema, authentication, shop membership and row-level security.
2. Server-side AI intent extraction with schema validation; never expose provider API keys in the browser.
3. Atomic sale/stock updates, idempotency keys, stock-movement audit trail and server-calculated totals.
4. Persisted customer reservations with atomic availability checks and expiry/release policy.
5. Browser audio recording/transcription fallback and accessible spoken responses.
6. Deploy a stable demo, then integrate official WhatsApp Business Cloud API through a separate transport adapter.

## Product rules

- AI proposes an interpretation; the user confirms; trusted application code performs the transaction.
- Stock and money calculations must be deterministic and server-authoritative in production.
- Gross profit is revenue minus recorded cost of goods sold. It is not net profit and excludes operating expenses.
- Reservations reduce available-to-promise quantity but are not sales and do not collect payment.
- Never report a transaction as successful until the database commit succeeds.
- Never put a Supabase service-role key or an AI provider key in a `VITE_*` variable.

## Environment

Copy `.env.example` to `.env.local` if using Supabase in a later step. Only public project URL and anon key belong in frontend variables; secure keys belong in server-side secrets.