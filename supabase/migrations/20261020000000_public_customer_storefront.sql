-- Public customer storefront: expose only public shop/product fields and keep reservations transactional.
alter table public.shops
  add column if not exists owner_name text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists category text not null default 'General',
  add column if not exists description text,
  add column if not exists is_public boolean not null default true;

create or replace view public.public_storefront
with (security_barrier = true)
as
select
  s.id as shop_id,
  s.name as shop_name,
  coalesce(s.owner_name, '') as owner_name,
  coalesce(s.phone, '') as phone,
  coalesce(s.address, '') as address,
  coalesce(s.city, '') as city,
  coalesce(s.category, 'General') as shop_category,
  coalesce(s.description, '') as description,
  p.id as product_id,
  p.name as product_name,
  p.category as product_category,
  p.selling_price_kobo,
  greatest(p.stock_quantity - coalesce((
    select sum(r.quantity)::integer
    from public.reservations r
    where r.product_id = p.id
      and r.status = 'active'
      and r.expires_at > now()
  ), 0), 0) as available_quantity
from public.shops s
join public.products p on p.shop_id = s.id
where s.is_public = true and p.is_active = true;

grant select on public.public_storefront to anon, authenticated;

create or replace function public.create_public_reservation(
  p_product_id uuid,
  p_quantity integer,
  p_customer_name text,
  p_customer_contact text,
  p_duration_minutes integer default 60
)
returns table(reservation_id uuid, expires_at timestamptz, shop_name text, product_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_shop public.shops%rowtype;
  v_reserved integer;
  v_reservation_id uuid;
  v_expires_at timestamptz;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then
    raise exception 'Quantity must be between 1 and 50';
  end if;
  if nullif(trim(p_customer_name), '') is null or length(trim(p_customer_name)) > 120 then
    raise exception 'Enter a valid customer name';
  end if;
  if nullif(trim(p_customer_contact), '') is null or length(trim(p_customer_contact)) > 80 then
    raise exception 'Enter a valid phone number or contact';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 10 or p_duration_minutes > 1440 then
    raise exception 'Reservation duration must be between 10 minutes and 24 hours';
  end if;

  select * into v_product from public.products where id = p_product_id and is_active = true for update;
  if not found then raise exception 'This item is no longer available'; end if;
  select * into v_shop from public.shops where id = v_product.shop_id and is_public = true;
  if not found then raise exception 'This shop is not accepting public reservations'; end if;

  update public.reservations
    set status = 'expired', updated_at = now()
    where product_id = p_product_id and status = 'active' and expires_at <= now();

  select coalesce(sum(quantity), 0)::integer into v_reserved
    from public.reservations
    where product_id = p_product_id and status = 'active' and expires_at > now();

  if v_product.stock_quantity - v_reserved < p_quantity then
    raise exception 'Not enough unreserved stock. Available now: %', greatest(v_product.stock_quantity - v_reserved, 0);
  end if;

  v_expires_at := now() + make_interval(mins => p_duration_minutes);
  insert into public.reservations(shop_id, product_id, customer_name, customer_contact, quantity, status, expires_at)
    values (v_product.shop_id, v_product.id, trim(p_customer_name), trim(p_customer_contact), p_quantity, 'active', v_expires_at)
    returning id into v_reservation_id;

  return query select v_reservation_id, v_expires_at, v_shop.name, v_product.name;
end;
$$;

create or replace function public.cancel_public_reservation(
  p_reservation_id uuid,
  p_customer_contact text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.reservations
    set status = 'cancelled', updated_at = now()
    where id = p_reservation_id
      and status = 'active'
      and expires_at > now()
      and lower(trim(customer_contact)) = lower(trim(p_customer_contact));
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'Reservation not found, expired, or contact does not match'; end if;
  return true;
end;
$$;

revoke all on function public.create_public_reservation(uuid, integer, text, text, integer) from public;
grant execute on function public.create_public_reservation(uuid, integer, text, text, integer) to anon, authenticated;
revoke all on function public.cancel_public_reservation(uuid, text) from public;
grant execute on function public.cancel_public_reservation(uuid, text) to anon, authenticated;
