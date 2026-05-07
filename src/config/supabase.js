const { createClient } = require('@supabase/supabase-js');

const url            = process.env.SUPABASE_URL;
const anonKey        = process.env.SUPABASE_ANON_KEY;
const serviceKey     = process.env.SUPABASE_SERVICE_KEY;

// anon client — used only for signInWithPassword (runs user-context auth)
const supabase      = createClient(url, anonKey);

// service role client — bypasses RLS, used for all server-side DB writes
const supabaseAdmin = createClient(url, serviceKey);

module.exports = { supabase, supabaseAdmin };
