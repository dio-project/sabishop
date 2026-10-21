-- Allow account deletion to anonymize shop creators and retain sales history.
alter table public.shops alter column created_by drop not null;
alter table public.sales alter column recorded_by drop not null;

with ranked_shops as (
  select id, name,
    row_number() over (partition by lower(btrim(name)) order by created_at, id) as duplicate_number,
    count(*) over (partition by lower(btrim(name))) as duplicate_count
  from public.shops
)
update public.shops target
set name = ranked_shops.name || ' (' || ranked_shops.duplicate_number || ')'
from ranked_shops
where target.id = ranked_shops.id and ranked_shops.duplicate_count > 1 and ranked_shops.duplicate_number > 1;

create unique index if not exists shops_name_unique_ci on public.shops (lower(btrim(name)));

create or replace function public.create_shop_with_owner(p_name text)
returns uuid language plpgsql security definer set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_shop_id uuid; v_name text := btrim(p_name);
begin
 if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
 if v_name is null or length(v_name)<2 or length(v_name)>100 then raise exception 'Shop name must be between 2 and 100 characters' using errcode = '22023'; end if;
 if exists(select 1 from public.shops s where lower(btrim(s.name))=lower(v_name)) then raise exception 'That shop name is already taken. Please choose a different name.' using errcode='23505'; end if;
 insert into public.shops(name,created_by) values(v_name,v_user_id) returning id into v_shop_id;
 insert into public.shop_members(shop_id,user_id,role) values(v_shop_id,v_user_id,'owner');
 return v_shop_id;
exception when unique_violation then raise exception 'That shop name is already taken. Please choose a different name.' using errcode='23505';
end;
$function$;
