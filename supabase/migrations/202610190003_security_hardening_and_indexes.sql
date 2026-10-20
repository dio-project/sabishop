-- Harden public RPC execution and index common foreign-key filters.
revoke all on function public.is_shop_member(uuid) from anon;
revoke all on function public.is_shop_member(uuid) from public;
grant execute on function public.is_shop_member(uuid) to authenticated;

revoke all on function public.create_shop_with_owner(text) from anon;
revoke all on function public.create_shop_with_owner(text) from public;
grant execute on function public.create_shop_with_owner(text) to authenticated;

revoke all on function public.record_sale(uuid, jsonb, text, text) from anon;
revoke all on function public.record_sale(uuid, jsonb, text, text) from public;
grant execute on function public.record_sale(uuid, jsonb, text, text) to authenticated;

create index if not exists shop_members_user_id_idx on public.shop_members(user_id);
create index if not exists shops_created_by_idx on public.shops(created_by);
create index if not exists products_shop_id_idx on public.products(shop_id);
create index if not exists sales_recorded_by_idx on public.sales(recorded_by);
create index if not exists sale_items_product_id_idx on public.sale_items(product_id);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists stock_movements_shop_id_idx on public.stock_movements(shop_id);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
create index if not exists reservations_product_id_idx on public.reservations(product_id);
create index if not exists command_requests_shop_id_idx on public.command_requests(shop_id);
create index if not exists command_requests_requested_by_idx on public.command_requests(requested_by);