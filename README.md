# SabiShop

**Your shop, in control.** SabiShop is an AI-assisted shop ledger for neighbourhood retailers. The live workspace supports sign-in, inventory, restocking, stock checks, and confirmed sales backed by Supabase.

## Live backend status

- Supabase project: \`qatkotmliqxrzoltkmfu\` (London region)
- PostgreSQL schema with row-level security on all application tables
- Owner-shop bootstrap RPC
- Atomic, idempotent sale RPC that checks stock, snapshots price/cost, updates inventory, and writes stock-movement audit rows
- Atomic stock adjustment/restock RPC with audit records
- Authenticated Gemini intent-interpreter Edge Function (\`interpret-command\`)
- Persistent per-user chat history, message timestamps, and Nigerian Pidgin command support
- Browser UI connected to Supabase Auth, products, sales, sale confirmation, and restocking

The first login creates a private shop and loads a clearly labelled sample catalogue if the shop has no products. Replace sample quantities and prices with verified real inventory before using it as an operational ledger.

## Run locally

Requires Node.js 22.12+ recommended.

\`\`\`bash
npm install
npm run dev
\`\`\`

The frontend has safe public project URL/publishable-key defaults for this SabiShop project. You can override them using \`.env.local\`:

\`\`\`bash
VITE_SUPABASE_URL=https://qatkotmliqxrzoltkmfu.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_4sT0dfXoMHYiKKnlyufsIQ_gm5g22K_
\`\`\`

Only a Supabase publishable/legacy anon key belongs in the browser. Never expose a Supabase secret/service-role key or an AI provider key in \`VITE_*\` variables or GitHub.

## Enable live AI interpretation

The Edge Function is deployed with JWT verification enabled. Configure Groq as the primary provider and retain Gemini as a fallback:

1. Create a Groq API key at [console.groq.com/keys](https://console.groq.com/keys).
2. Open [SabiShop Edge Function secrets](https://supabase.com/dashboard/project/qatkotmliqxrzoltkmfu/functions/secrets).
3. Add the key as a server-side secret named `GROQ_API_KEY`. The function uses Groq's `openai/gpt-oss-120b` model.
4. Keep `GEMINI_API_KEY` configured as the fallback provider, then retry a command in the app.

Never commit either provider key or put it in a `VITE_*` variable. Groq's free-tier limits can change and are not an uptime guarantee. If Groq fails, the function tries Gemini with a short timeout. Without a working provider key, the UI can use only limited exact-name fallback.

## Product rules and current scope

- AI interprets a request; it never directly changes inventory.
- Sale confirmation runs through a trusted atomic database function. The app reports success only after the database returns a committed sale.
- All money is stored as integer kobo. UI amounts are entered/displayed in naira.
- Gross profit is revenue minus cost of goods sold and is not net profit. The current summary reports recorded revenue; item-level profit reporting should be added before using financial summaries operationally.
- Customer reservations are present in the schema but are **not yet wired into the live UI**. No reservation is created or cancelled by the current frontend.
- Debt/credit-ledger workflows, batch expiry tracking, voice playback, and official WhatsApp Cloud API integration remain future work.

## Build

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Database migrations

The project schema is in \`supabase/schema.sql\`, followed by migrations in \`supabase/migrations/\`. These are applied to the linked Supabase project. Do not run \`schema.sql\` again on the already-initialized project; use ordered migrations for further changes.
