// =====================================================================
// Conexión a Supabase (este archivo reemplaza a supabase-confing.js)
//
// 1) En Supabase: Project Settings → API.
// 2) Copia la "Project URL" y la clave "anon" (o "publishable") aquí abajo.
//
// La clave anon es pública por diseño: la seguridad real la dan las
// políticas RLS de supabase-setup.sql. NUNCA pegues aquí la clave
// "service_role" ni la contraseña de la base de datos.
//
// Mientras los valores digan "PEGA_AQUI", la app funciona en MODO DEMO
// con datos simulados, sin conexión a ningún servidor.
// =====================================================================

const SUPABASE_URL = 'PEGA_AQUI_LA_URL';
const SUPABASE_ANON_KEY = 'PEGA_AQUI_LA_ANON_KEY';

export const MODO_DEMO =
  SUPABASE_URL.startsWith('PEGA_') || SUPABASE_ANON_KEY.startsWith('PEGA_');

export let supabase = null;

if (!MODO_DEMO) {
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
  );
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
