import { createClient } from '@supabase/supabase-js';

// Credenciales directas de Supabase
const url = 'https://uwnjmqnznrkfxtvqujcf.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3bmptcW56bnJrZnh0dnF1amNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDk5NzQsImV4cCI6MjEwMTY4NTk3NH0.tEiwT_IvT7VtvV9qcU5LiCC8q4nCs3oRm1_4seGfP2g';

export const cloudEnabled = Boolean(url && anonKey);
const supabase = cloudEnabled ? createClient(url, anonKey) : null;
const BUCKET = 'replay-data';

const need = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};

export async function signIn(email, password) {
  const sb = need();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const sb = need();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = need();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuth(callback) {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
  return () => subscription.unsubscribe();
}

// Sincronización con la tabla jz_sync y Storage
export async function loadCloudData() {
  const user = await getUser();
  if (!user) return null;
  const sb = need();
  
  const { data, error } = await sb
    .from('jz_sync')
    .select('*')
    .eq('user_id', user.id)
    .single();
    
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function saveCloudData(payload) {
  const user = await getUser();
  if (!user) return;
  const sb = need();
  
  const row = {
    user_id: user.id,
    ...payload,
    updated_at: new Date().toISOString()
  };
  
  const { error } = await sb
    .from('jz_sync')
    .upsert(row);
    
  if (error) throw error;
}
