-- Run after supabase/schema.sql. All money is stored as integer kobo.
create or replace function public.record_sale(
  p_shop_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_price bigint;
  v_cost bigint;
  v_stock integer;
  v_total bigint := 0;
  v_sale_id uuid;
  v_existing_total bigint;
  v_item_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.shop_members
    where shop_id = p_shop_id and user_id = v_user_id
  ) then
    raise exception 'You do not have access to this shop' using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 160 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;

  if p_source not in ('web', 'voice', 'whatsapp', 'manual') then
    raise exception 'Unsupported sale source' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale items must be an array' using errcode = '22023';
  end if;

  select count(*) into v_item_count from jsonb_array_elements(p_items);
  if v_item_count < 1 or v_item_count > 50 then
    raise exception 'A sale must contain between 1 and 50 item lines' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    group by e.value->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'Each product must appear once per sale' using errcode = '22023';
  end if;

  -- Serialize requests sharing the same idempotency key. A retry returns the
  -- original transaction rather than decrementing inventory twice.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_idempotency_key, 0));

  select id, total_kobo into v_sale_id, v_existing_total
  from public.sales
  where shop_id = p_shop_id and idempotency_key = p_idempotency_key;

  if v_sale_id is not null then
    return jsonb_build_object('sale_id', v_sale_id, 'total_kobo', v_existing_total, 'duplicate', true);
  end if;

  -- Lock product rows in stable UUID order to prevent concurrent sales from
  -- overselling stock and to reduce deadlock risk.
  for v_item in
    select e.value from jsonb_array_elements(p_items) as e(value)
    order by (e.value->>'product_id')::uuid
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 then
      raise exception 'Quantity must be a positive integer' using errcode = '22023';
    end if;

    select selling_price_kobo, unit_cost_kobo, stock_quantity
      into v_price, v_cost, v_stock
    from public.products
    where id = v_product_id and shop_id = p_shop_id and is_active = true
    for update;

    if not found then
      raise exception 'A selected product was not found in this shop' using errcode = 'P0002';
    end if;
    if v_stock < v_quantity then
      raise exception 'Insufficient stock for product %', v_product_id using errcode = '23514';
    end if;
    v_total := v_total + (v_price * v_quantity);
  end loop;

  insert into public.sales (shop_id, recorded_by, total_kobo, idempotency_key, source)
  values (p_shop_id, v_user_id, v_total, p_idempotency_key, p_source)
  returning id into v_sale_id;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select selling_price_kobo, unit_cost_kobo
      into v_price, v_cost
    from public.products
    where id = v_product_id and shop_id = p_shop_id and is_active = true;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price_kobo, unit_cost_kobo)
    values (v_sale_id, v_product_id, v_quantity, v_price, v_cost);

    update public.products
    set stock_quantity = stock_quantity - v_quantity, updated_at = now()
    where id = v_product_id and shop_id = p_shop_id;

    insert into public.stock_movements (shop_id, product_id, movement_type, quantity_delta, reference_id, created_by)
    values (p_shop_id, v_product_id, 'sale', -v_quantity, v_sale_id, v_user_id);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_kobo', v_total, 'duplicate', false);
end;
$$;

revoke all on function public.record_sale(uuid, jsonb, text, text) from public;
grant execute on function public.record_sale(uuid, jsonb, text, text) to authenticated;