import { createClient } from "@supabase/supabase-js";

// 環境変数から接続情報を取得（VercelのEnvironment Variablesで設定）
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
