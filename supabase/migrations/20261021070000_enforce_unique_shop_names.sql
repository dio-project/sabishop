-- Enforce case-insensitive shop-name uniqueness and improve signup validation.
-- The newer duplicate was an empty test shop (no sales or reservations), so retain it
-- and give it a distinct name rather than deleting any records.
update public.shops
set name = name || ' (2)'
where id = '80453dae-d891-40db-aaca-1ae9a2fc4bd5'
  and exists (
    select 1 from public.shops s
    where s.id = 'a51f3d2c-8152-45b2-b20c-a8cdefd94121'
      and lower(btrim(s.name)) = lower(btrim(public.shops.name))
  );

create unique index if not exists shops_name_unique_ci
  on public.shops (lower(btrim(name)));

create or replace function public.create_shop_with_owner(p_name text)
returns uuid language plpgsql security definer set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_shop_id uuid;
  v_name text := btrim(p_name);
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'Shop name must be between 2 and 100 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.shops s where lower(btrim(s.name)) = lower(v_name)) then
    raise exception 'That shop name is already taken. Please choose a different name.' using errcode = '23505';
  end if;
  insert into public.shops (name, created_by) values (v_name, v_user_id) returning id into v_shop_id;
  insert into public.shop_members (shop_id, user_id, role) values (v_shop_id, v_user_id, 'owner');
  return v_shop_id;
exception when unique_violation then
  raise exception 'That shop name is already taken. Please choose a different name.' using errcode = '23505';
end;
$function$;
