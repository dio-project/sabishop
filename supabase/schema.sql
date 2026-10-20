-- SabiShop initial data model. Review and apply in a non-production Supabase project first.
create extension if not exists pgcrypto;

create type public.shop_role as enum ('owner', 'staff');
create type public.sale_status as enum ('completed', 'voided');
create type public.reservation_status as enum ('active', 'collected', 'cancelled', 'expired');

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code text not null default 'NGN' check (currency_code = 'NGN'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.shop_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  category text not null default 'General',
  selling_price_kobo bigint not null check (selling_price_kobo >= 0),
  unit_cost_kobo bigint not null check (unit_cost_kobo >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, normalized_name)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  status public.sale_status not null default 'completed',
  total_kobo bigint not null check (total_kobo >= 0),
  idempotency_key text not null,
  source text not null default 'web' check (source in ('web', 'voice', 'whatsapp', 'manual')),
  created_at timestamptz not null default now(),
  unique (shop_id, idempotency_key)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  unit_cost_kobo bigint not null check (unit_cost_kobo >= 0),
  line_total_kobo bigint generated always as (quantity::bigint * unit_price_kobo) stored
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('sale', 'restock', 'adjustment', 'reservation_release')),
  quantity_delta integer not null check (quantity_delta <> 0),
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  customer_name text,
  customer_contact text,
  quantity integer not null check (quantity > 0),
  status public.reservation_status not null default 'active',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.command_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  source text not null default 'web',
  raw_text text not null,
  interpreted_intent jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'failed')),
  result_reference uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index products_shop_active_idx on public.products(shop_id, is_active);
create index sales_shop_created_idx on public.sales(shop_id, created_at desc);
create index stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index reservations_shop_status_expiry_idx on public.reservations(shop_id, status, expires_at);

-- Membership helper avoids repeating membership subqueries in each policy.
create or replace function public.is_shop_member(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = target_shop_id and sm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_shop_member(uuid) from public;
grant execute on function public.is_shop_member(uuid) to authenticated;

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.reservations enable row level security;
alter table public.command_requests enable row level security;

create policy "members can read their shops" on public.shops
for select to authenticated using (public.is_shop_member(id) or created_by = (select auth.uid()));

create policy "owners can create shops" on public.shops
for insert to authenticated with check (created_by = (select auth.uid()));

create policy "members can read membership" on public.shop_members
for select to authenticated using (user_id = (select auth.uid()) or public.is_shop_member(shop_id));

create policy "members can read products" on public.products
for select to authenticated using (public.is_shop_member(shop_id));

create policy "owners and staff can add products" on public.products
for insert to authenticated with check (public.is_shop_member(shop_id));

create policy "members can update products" on public.products
for update to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

create policy "members can read sales" on public.sales
for select to authenticated using (public.is_shop_member(shop_id));

create policy "members can read sale items" on public.sale_items
for select to authenticated using (exists (
  select 1 from public.sales s where s.id = sale_id and public.is_shop_member(s.shop_id)
));

create policy "members can read stock movements" on public.stock_movements
for select to authenticated using (public.is_shop_member(shop_id));

create policy "members can read reservations" on public.reservations
for select to authenticated using (public.is_shop_member(shop_id));

create policy "members can create reservations" on public.reservations
for insert to authenticated with check (public.is_shop_member(shop_id));

create policy "members can update reservations" on public.reservations
for update to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

create policy "members can read commands" on public.command_requests
for select to authenticated using (public.is_shop_member(shop_id));

create policy "members can create commands" on public.command_requests
for insert to authenticated with check (public.is_shop_member(shop_id));

-- Intentionally no client-side insert policy for sales/sale_items/stock_movements.
-- Production sale recording must go through a trusted RPC/Edge Function that
-- validates stock, checks idempotency, snapshots price/cost and commits atomically.
