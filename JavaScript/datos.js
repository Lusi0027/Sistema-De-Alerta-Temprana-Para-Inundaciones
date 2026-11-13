// =====================================================================
// Capa de datos. Las páginas solo hablan con este archivo; él decide si
// usa Supabase o el MODO DEMO (datos simulados guardados en el navegador).
// =====================================================================
import { supabase, MODO_DEMO } from './supabase-config.js';
import { CONFIG_POR_DEFECTO, calcularEstado } from './estado.js';

// ---------- Utilidades ----------
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function leerLS(clave, defecto) {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? defecto : JSON.parse(v);
  } catch {
    return defecto;
  }
}
function guardarLS(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}

function normalizarLectura(l) {
  return {
    ...l,
    distancia_cm: l.distancia_cm == null ? null : Number(l.distancia_cm),
    nivel_cm: Number(l.nivel_cm),
    velocidad_cm_min: Number(l.velocidad_cm_min),
  };
}

function normalizarConfig(c) {
  const cfg = { ...CONFIG_POR_DEFECTO };
  if (c) for (const k of Object.keys(CONFIG_POR_DEFECTO)) if (c[k] != null) cfg[k] = Number(c[k]);
  return cfg;
}

/** Valida umbrales; lanza Error con un mensaje claro si algo no tiene sentido. */
export function validarConfig(cfg, alturaSensor) {
  const nums = [...Object.values(cfg), alturaSensor];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('Completa todos los campos con números válidos.');
  }
  if (cfg.nivel_amarillo_cm < 0 || cfg.vel_amarillo_cm_min < 0) {
    throw new Error('Los umbrales no pueden ser negativos.');
  }
  if (cfg.nivel_rojo_cm <= cfg.nivel_amarillo_cm) {
    throw new Error('El nivel rojo debe ser mayor que el nivel amarillo.');
  }
  if (cfg.vel_rojo_cm_min <= cfg.vel_amarillo_cm_min) {
    throw new Error('La subida roja debe ser mayor que la subida amarilla.');
  }
  if (alturaSensor < 10 || alturaSensor > 400) {
    throw new Error('La altura del sensor debe estar entre 10 y 400 cm.');
  }
}

// =====================================================================
// MODO DEMO
// =====================================================================
const CLAVE_CONFIG = 'sa_demo_config';
const CLAVE_ESCENARIO = 'sa_demo_escenario';

const PUNTOS_DEMO = [
  'Villa Progreso II', 'Kennedy', 'Sarmiento', 'Barrio Lindo',
  'Cantalarrana', 'Los Guandules', 'Nuevo Renacer', 'La Barca',
].map((nombre, i) => ({
  id: i + 1, nombre, sector: nombre, altura_sensor_cm: 100, activo: true,
}));

// Qué tan fuerte "llueve" en cada punto durante el ciclo automático.
const AMPLITUD_DEMO = { 1: 1, 2: 1, 3: 0.75 }; // el resto apenas se mueve

const ESCENARIOS_DEMO = {
  verde: { nivel: 4, vel: 0.1 },
  amarillo: { nivel: 24, vel: 2.8 },
  rojo: { nivel: 46, vel: 6.1 },
};

export function escenarioDemo() {
  return leerLS(CLAVE_ESCENARIO, 'auto');
}
export function fijarEscenarioDemo(escenario) {
  guardarLS(CLAVE_ESCENARIO, escenario);
}

// Ciclo de 20 min: seco → sube lento → sube rápido → máximo → baja.
function formaCiclo(minutos) {
  if (minutos < 3) return 3;
  if (minutos < 9) return 3 + ((minutos - 3) / 6) * 27;   // hasta 30 cm
  if (minutos < 12) return 30 + ((minutos - 9) / 3) * 16;  // hasta 46 cm
  if (minutos < 14) return 46;
  return 46 - ((minutos - 14) / 6) * 43;                   // vuelve a 3 cm
}

function nivelAuto(id, t) {
  const cicloMs = 20 * 60000;
  const m = ((t + (id - 1) * 150000) % cicloMs) / 60000;
  const amp = AMPLITUD_DEMO[id] ?? 0.2;
  return 3 + (formaCiclo(m) - 3) * amp;
}

function configDemo(id) {
  const g = leerLS(CLAVE_CONFIG, {});
  return normalizarConfig(g[id]?.cfg);
}

function lecturaDemo(punto, t) {
  const escenario = escenarioDemo();
  const ruido = Math.sin(t / 9000 + punto.id * 1.7) * 0.25;
  let nivel;
  let vel;
  if (ESCENARIOS_DEMO[escenario]) {
    nivel = ESCENARIOS_DEMO[escenario].nivel + ruido;
    vel = ESCENARIOS_DEMO[escenario].vel;
  } else {
    nivel = nivelAuto(punto.id, t) + ruido;
    vel = nivelAuto(punto.id, t) - nivelAuto(punto.id, t - 60000); // cm en 1 min
  }
  nivel = Math.max(0, r1(nivel));
  vel = r2(vel);
  return {
    id: t,
    punto_id: punto.id,
    distancia_cm: r1(punto.altura_sensor_cm - nivel),
    nivel_cm: nivel,
    velocidad_cm_min: vel,
    estado: calcularEstado(nivel, vel, configDemo(punto.id)),
    creado_en: new Date(t).toISOString(),
  };
}

async function puntosDemo() {
  const g = leerLS(CLAVE_CONFIG, {});
  return PUNTOS_DEMO
    .map((p) => ({ ...p, altura_sensor_cm: g[p.id]?.altura ?? p.altura_sensor_cm }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// =====================================================================
// API pública
// =====================================================================
export async function obtenerPuntos() {
  if (MODO_DEMO) return puntosDemo();
  const { data, error } = await supabase
    .from('puntos').select('*').eq('activo', true).order('nombre');
  if (error) throw error;
  return data.map((p) => ({ ...p, altura_sensor_cm: Number(p.altura_sensor_cm) }));
}

export async function obtenerConfig(puntoId) {
  if (MODO_DEMO) return configDemo(puntoId);
  const { data, error } = await supabase
    .from('configuracion').select('*').eq('punto_id', puntoId).maybeSingle();
  if (error) throw error;
  return normalizarConfig(data);
}

export async function ultimaLectura(puntoId) {
  if (MODO_DEMO) {
    const p = (await puntosDemo()).find((x) => x.id === puntoId);
    return p ? lecturaDemo(p, Date.now()) : null;
  }
  const { data, error } = await supabase
    .from('lecturas').select('*').eq('punto_id', puntoId)
    .order('creado_en', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? normalizarLectura(data) : null;
}

/** Última lectura de cada punto (para la lista del panel). */
export async function ultimasLecturas() {
  if (MODO_DEMO) {
    const t = Date.now();
    return (await puntosDemo()).map((p) => lecturaDemo(p, t));
  }
  const { data, error } = await supabase.from('ultima_lectura_por_punto').select('*');
  if (error) throw error;
  return data.map(normalizarLectura);
}

/** Lecturas desde `desdeMs` (milisegundos), de la más vieja a la más nueva. */
export async function obtenerHistorial(puntoId, desdeMs) {
  if (MODO_DEMO) {
    const p = (await puntosDemo()).find((x) => x.id === puntoId);
    if (!p) return [];
    const ahora = Date.now();
    const paso = Math.max(60000, Math.round((ahora - desdeMs) / 2000));
    const filas = [];
    for (let t = desdeMs; t <= ahora; t += paso) filas.push(lecturaDemo(p, t));
    filas.push(lecturaDemo(p, ahora));
    return filas;
  }
  const TAM = 1000; // límite por petición de Supabase
  const desde = new Date(desdeMs).toISOString();
  const filas = [];
  for (let pagina = 0; pagina < 5; pagina++) {
    const { data, error } = await supabase
      .from('lecturas')
      .select('creado_en,distancia_cm,nivel_cm,velocidad_cm_min,estado')
      .eq('punto_id', puntoId)
      .gte('creado_en', desde)
      .order('creado_en', { ascending: false })
      .range(pagina * TAM, (pagina + 1) * TAM - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < TAM) break;
  }
  return filas.reverse().map(normalizarLectura);
}

/** Avisa cada vez que llega una lectura nueva. Devuelve una función para cancelar. */
export function suscribirLecturas(puntoId, callback) {
  if (MODO_DEMO) {
    const id = setInterval(async () => {
      const l = await ultimaLectura(puntoId);
      if (l) callback(l);
    }, 5000);
    return () => clearInterval(id);
  }
  const canal = supabase
    .channel(`lecturas-${puntoId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lecturas', filter: `punto_id=eq.${puntoId}` },
      (payload) => callback(normalizarLectura(payload.new)))
    .subscribe();
  return () => supabase.removeChannel(canal);
}

export async function guardarConfig(puntoId, cfg, alturaSensor) {
  validarConfig(cfg, alturaSensor);

  if (MODO_DEMO) {
    const g = leerLS(CLAVE_CONFIG, {});
    g[puntoId] = { cfg, altura: alturaSensor };
    guardarLS(CLAVE_CONFIG, g);
    return;
  }

  const a = await supabase.from('configuracion').update(cfg).eq('punto_id', puntoId).select();
  if (a.error) throw a.error;
  if (!a.data?.length) {
    throw new Error('Tu cuenta no tiene permiso para cambiar los umbrales. Pide que te agreguen a la lista de operadores.');
  }
  const b = await supabase.from('puntos')
    .update({ altura_sensor_cm: alturaSensor }).eq('id', puntoId).select();
  if (b.error) throw b.error;
}

// ---------- Sesión (solo operadores) ----------
export async function sesionActual() {
  if (MODO_DEMO) return { email: 'demo' };
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function iniciarSesion(correo, clave) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });
  if (error) throw error;
  return data.user;
}

export async function cerrarSesion() {
  if (!MODO_DEMO) await supabase.auth.signOut();
}
