import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !authorization) return new Response(JSON.stringify({
    error: "Account deletion is not configured.",
  }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: userError } = await userClient.auth.getUser();
  if (userError || !data.user) return new Response(JSON.stringify({
    error: "Please sign in again before deleting your account.",
  }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = data.user;
  const isRetailer = user.user_metadata?.account_type !== "customer";
  try {
    if (!isRetailer) {
      // Reservations are currently stored as guest bookings, so remove bookings tied
      // to the customer's verified account phone when deleting that account.
      const phone = String(user.user_metadata?.phone || "").trim();
      if (phone) {
        const { error: reservationError } = await admin.from("reservations")
          .delete().eq("customer_contact", phone);
        if (reservationError) throw reservationError;
      }
    }

    if (isRetailer) {
      const { data: memberships, error } = await admin.from("shop_members").select("shop_id").eq("user_id", user.id);
      if (error) throw error;
      const shopIds = (memberships || []).map((row: { shop_id: string }) => row.shop_id);
      if (shopIds.length) {
        const { error: shopError } = await admin.from("shops").update({
          is_public: false, owner_name: null, phone: null,
        }).in("id", shopIds);
        if (shopError) throw shopError;
        const { error: memberError } = await admin.from("shop_members").delete().eq("user_id", user.id);
        if (memberError) throw memberError;
      }
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Could not delete this account." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
