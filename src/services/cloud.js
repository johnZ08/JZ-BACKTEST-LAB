import { createClient } from '@supabase/supabase-js';

// Define estas variables en .env (local) y en Cloudflare Pages > Settings > Environment variables:
//   VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = Boolean(url && anonKey);
const supabase = cloudEnabled ? createClient(url, anonKey) : null;
const BUCKET = 'replay-data';

const need = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};

// ---- Sesión ----
export const signIn = (email, password) => need().auth.signInWithPassword({ email, password });
export const signUp = (email, password) => need().auth.signUp({ email, password });
export const signOut = () => need().auth.signOut();
export const getUser = async () => (await need().auth.getSession()).data.session?.user ?? null;
export const onAuth = (cb) =>
  need().auth.onAuthStateChange((_event, session) => cb(session?.user ?? null)).data.subscription;

// ---- Fila de sincronización (una por usuario) ----
export const pullRemote = async (userId) => {
  const { data, error } = await need().from('jz_sync').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
};
export const pushRemote = async (userId, patch) => {
  const { error } = await need()
    .from('jz_sync')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
};

// Unión de trades por id con "lápidas" de borrado: al sincronizar PC y celular nunca se pierde un trade
export const mergeTrades = (localItems, localDeleted, remoteItems, remoteDeleted) => {
  const del = new Set([...localDeleted, ...remoteDeleted]);
  const byId = new Map();
  [...localItems, ...remoteItems].forEach((t) => {
    if (!del.has(t.id)) byId.set(t.id, t);
  });
  return { items: [...byId.values()], deleted: [...del] };
};

// ---- CSV maestro: binario comprimido (gzip) en Supabase Storage, en la carpeta privada del usuario ----
export const uploadCsv = async (userId, floatBuf) => {
  let blob = new Blob([floatBuf]);
  let gz = false;
  if (typeof CompressionStream !== 'undefined') {
    blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    gz = true;
  }
  const path = `${userId}/master${gz ? '.bin.gz' : '.bin'}`;
  const { error } = await need().storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'application/octet-stream'
  });
  if (error) throw error;
  return path;
};
export const downloadCsv = async (path) => {
  const { data, error } = await need().storage.from(BUCKET).download(path);
  if (error) throw error;
  const stream = path.endsWith('.gz') ? data.stream().pipeThrough(new DecompressionStream('gzip')) : data.stream();
  return new Float64Array(await new Response(stream).arrayBuffer());
};
