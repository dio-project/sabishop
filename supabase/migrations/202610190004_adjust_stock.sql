create or replace function public.adjust_stock(
  p_shop_id uuid,
  p_product_id uuid,
  p_quantity_delta integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stock integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Stock change must be a non-zero whole number' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.shop_members
    where shop_id = p_shop_id and user_id = v_user_id
  ) then
    raise exception 'You do not have access to this shop' using errcode = '42501';
  end if;

  select stock_quantity into v_stock
  from public.products
  where id = p_product_id and shop_id = p_shop_id and is_active = true
  for update;

  if not found then
    raise exception 'Product was not found in this shop' using errcode = 'P0002';
  end if;
  if v_stock + p_quantity_delta < 0 then
    raise exception 'Stock cannot become negative' using errcode = '23514';
  end if;

  update public.products
  set stock_quantity = stock_quantity + p_quantity_delta, updated_at = now()
  where id = p_product_id and shop_id = p_shop_id;

  insert into public.stock_movements(shop_id, product_id, movement_type, quantity_delta, note, created_by)
  values (
    p_shop_id, p_product_id,
    case when p_quantity_delta > 0 then 'restock' else 'adjustment' end,
    p_quantity_delta,
    left(coalesce(p_note, ''), 500),
    v_user_id
  );

  return jsonb_build_object('product_id', p_product_id, 'stock_quantity', v_stock + p_quantity_delta);
end;
$$;

revoke all on function public.adjust_stock(uuid, uuid, integer, text) from anon;
revoke all on function public.adjust_stock(uuid, uuid, integer, text) from public;
grant execute on function public.adjust_stock(uuid, uuid, integer, text) to authenticated;