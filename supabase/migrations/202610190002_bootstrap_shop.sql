create or replace function public.create_shop_with_owner(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_shop_id uuid;
  v_name text := trim(p_name);
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'Shop name must be between 2 and 100 characters' using errcode = '22023';
  end if;

  insert into public.shops (name, created_by)
  values (v_name, v_user_id)
  returning id into v_shop_id;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_user_id, 'owner');

  return v_shop_id;
end;
$$;

revoke all on function public.create_shop_with_owner(text) from public;
grant execute on function public.create_shop_with_owner(text) to authenticated;