import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const LINE_CHANNEL_ID = import.meta.env.VITE_LINE_CHANNEL_ID;
export const REDIRECT_URI = `${window.location.origin}/callback`;
