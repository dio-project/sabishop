create or replace function public.list_public_reservations(
  p_customer_name text,
  p_customer_contact text
)
returns table(
  reservation_id uuid,
  shop_name text,
  product_name text,
  quantity integer,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if nullif(trim(p_customer_name), '') is null or length(trim(p_customer_name)) > 120 then
    raise exception 'Enter the name used for the reservation';
  end if;
  if nullif(trim(p_customer_contact), '') is null or length(trim(p_customer_contact)) > 80 then
    raise exception 'Enter the contact used for the reservation';
  end if;

  return query
  select r.id, s.name, p.name, r.quantity, r.status, r.expires_at, r.created_at
  from public.reservations as r
  join public.shops as s on s.id = r.shop_id
  join public.products as p on p.id = r.product_id
  where lower(trim(r.customer_name)) = lower(trim(p_customer_name))
    and lower(trim(r.customer_contact)) = lower(trim(p_customer_contact))
  order by r.created_at desc
  limit 50;
end;
$function$;

revoke all on function public.list_public_reservations(text, text) from public;
grant execute on function public.list_public_reservations(text, text) to anon, authenticated;
