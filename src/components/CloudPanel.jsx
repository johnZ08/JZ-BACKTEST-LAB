import React, { useState } from 'react';
import { cloudEnabled, signIn, signUp, signOut } from './cloud.js';

const input =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-base md:text-sm text-white focus:outline-none focus:border-emerald-500 font-mono';

export default function CloudPanel({ user, status, onSyncNow }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const { data, error } = creating ? await signUp(email, password) : await signIn(email, password);
      if (error) throw error;
      if (creating && !data.session) setMsg('Revisa tu correo para confirmar la cuenta y luego entra.');
      else setOpen(false);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-2 md:py-1.5 rounded-lg text-xs font-mono font-bold border border-slate-800 bg-slate-950 text-slate-300 hover:text-white cursor-pointer"
      >
        ☁ {user ? status || 'Nube' : 'Nube'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 z-40 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs font-mono shadow-2xl">
          {!cloudEnabled ? (
            <p className="text-slate-400">
              Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver instrucciones de la nube).
            </p>
          ) : user ? (
            <>
              <p className="text-slate-300 break-all">{user.email}</p>
              <div className="flex gap-2">
                <button onClick={onSyncNow} className="flex-1 px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-400 cursor-pointer">
                  Sincronizar ahora
                </button>
                <button onClick={() => signOut()} className="flex-1 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 cursor-pointer">
                  Salir
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-2">
              <input type="email" required placeholder="correo" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
              <input type="password" required minLength={6} placeholder="contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
              <button type="submit" disabled={busy} className="w-full px-3 py-2.5 rounded-lg bg-emerald-500 text-slate-950 font-bold border border-emerald-400 disabled:opacity-50 cursor-pointer">
                {creating ? 'Crear cuenta' : 'Entrar'}
              </button>
              <button type="button" onClick={() => setCreating((c) => !c)} className="w-full text-slate-500 hover:text-slate-300 cursor-pointer">
                {creating ? 'Ya tengo cuenta' : 'Crear una cuenta'}
              </button>
              {msg && <p className="text-rose-400">{msg}</p>}
            </form>
          )}
          {user && status && <p className="text-slate-500">{status}</p>}
        </div>
      )}
    </div>
  );
}
