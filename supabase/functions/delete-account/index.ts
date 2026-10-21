import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),authorization=req.headers.get("Authorization");
 if(!url||!anonKey||!serviceKey||!authorization)return json({error:"Account deletion is not configured."},500);
 const userClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error:userError}=await userClient.auth.getUser();
 if(userError||!data.user)return json({error:"Please sign in again before deleting your account."},401);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),user=data.user,isRetailer=user.user_metadata?.account_type!=="customer";
 let shopIds:string[]=[],memberships:Array<{shop_id:string;role:string}>=[],clearedCreatorReference=false;
 try{
  if(!isRetailer){
   const phone=String(user.user_metadata?.phone||"").trim();
   if(phone){const {error}=await admin.from("reservations").delete().eq("customer_contact",phone);if(error)throw error;}
  }else{
   const {data:rows,error}=await admin.from("shop_members").select("shop_id,role").eq("user_id",user.id);
   if(error)throw error;
   memberships=(rows||[]) as Array<{shop_id:string;role:string}>;shopIds=[...new Set(memberships.map(r=>r.shop_id))];
   const {error:salesError}=await admin.from("sales").update({recorded_by:null}).eq("recorded_by",user.id);if(salesError)throw salesError;
   const {error:creatorError}=await admin.from("shops").update({created_by:null}).eq("created_by",user.id);if(creatorError)throw creatorError;clearedCreatorReference=true;
   if(memberships.length){const {error:memberError}=await admin.from("shop_members").delete().eq("user_id",user.id);if(memberError)throw memberError;}
  }
  const {error:deleteError}=await admin.auth.admin.deleteUser(user.id);if(deleteError)throw deleteError;
  if(isRetailer&&shopIds.length){const {error}=await admin.from("shops").update({is_public:false,owner_name:null,phone:null}).in("id",shopIds);if(error)console.error("Account deleted but shop privacy cleanup failed",error);}
  return json({success:true});
 }catch(error){
  console.error("delete-account failed",error);
  if(isRetailer){
   if(clearedCreatorReference){const {error}=await admin.from("shops").update({created_by:user.id}).eq("created_by",null).in("id",shopIds);if(error)console.error("Could not restore shop creator reference",error);}
   if(memberships.length){const {error}=await admin.from("shop_members").upsert(memberships.map(r=>({shop_id:r.shop_id,user_id:user.id,role:r.role})),{onConflict:"shop_id,user_id"});if(error)console.error("Could not restore shop membership",error);}
  }
  return json({error:error instanceof Error?error.message:"Could not delete this account."},500);
 }
});