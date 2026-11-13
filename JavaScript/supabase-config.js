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

const SUPABASE_URL = 'https://ujzanzktijleyipdnofk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqemFuemt0aWpsZXlpcGRub2ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MjYyMDAsImV4cCI6MjExMDEwMjIwMH0.y3y5iu9apjviPL6wQpgxnOyz4te9kWrHps_VwfKbeFw';

export const MODO_DEMO =
  SUPABASE_URL.startsWith('https://ujzanzktijleyipdnofk.supabase.co') || SUPABASE_ANON_KEY.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqemFuemt0aWpsZXlpcGRub2ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MjYyMDAsImV4cCI6MjExMDEwMjIwMH0.y3y5iu9apjviPL6wQpgxnOyz4te9kWrHps_VwfKbeFw');

export let supabase = null;

if (!MODO_DEMO) {
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
  );
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
