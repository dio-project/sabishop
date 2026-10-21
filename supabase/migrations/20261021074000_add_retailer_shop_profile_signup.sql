create or replace function public.update_shop_profile(
  p_shop_id uuid,
  p_owner_name text,
  p_phone text,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop_id and sm.user_id = auth.uid() and sm.role = 'owner'
  ) then
    raise exception 'Only the shop owner can update shop profile details' using errcode = '42501';
  end if;
  update public.shops
  set owner_name = nullif(btrim(p_owner_name), ''),
      phone = nullif(btrim(p_phone), ''),
      address = nullif(btrim(p_address), ''),
      is_public = true
  where id = p_shop_id;
end;
$function$;

revoke all on function public.update_shop_profile(uuid, text, text, text) from public;
grant execute on function public.update_shop_profile(uuid, text, text, text) to authenticated;
