// =====================================================================
// Ajustes: inicio de sesión del operador y edición de umbrales.
// El permiso real lo impone la base de datos (RLS + tabla operadores);
// esta página solo muestra el resultado con mensajes claros.
// =====================================================================
import { MODO_DEMO } from '../supabase-config.js';
import {
  obtenerPuntos, obtenerConfig, guardarConfig,
  sesionActual, iniciarSesion, cerrarSesion,
} from '../datos.js';

const $ = (id) => document.getElementById(id);
const el = {
  notaDemo: $('nota-demo'),
  seccionLogin: $('seccion-login'),
  formLogin: $('form-login'),
  correo: $('login-correo'),
  clave: $('login-clave'),
  seccionConfig: $('seccion-config'),
  formConfig: $('form-config'),
  punto: $('selector-punto'),
  altura: $('cfg-altura'),
  nivelAmarillo: $('cfg-nivel-amarillo'),
  nivelRojo: $('cfg-nivel-rojo'),
  velAmarillo: $('cfg-vel-amarillo'),
  velRojo: $('cfg-vel-rojo'),
  mensaje: $('mensaje'),
  guardar: $('btn-guardar'),
  salir: $('btn-salir'),
};

let puntos = [];

function mensaje(texto, tipo = 'error') {
  el.mensaje.textContent = texto;
  el.mensaje.className = tipo === 'ok' ? 'aviso ok' : 'aviso';
  el.mensaje.hidden = false;
}
function limpiarMensaje() { el.mensaje.hidden = true; }

async function cargarValores() {
  limpiarMensaje();
  const id = Number(el.punto.value);
  const punto = puntos.find((p) => p.id === id);
  try {
    const cfg = await obtenerConfig(id);
    el.altura.value = punto?.altura_sensor_cm ?? 100;
    el.nivelAmarillo.value = cfg.nivel_amarillo_cm;
    el.nivelRojo.value = cfg.nivel_rojo_cm;
    el.velAmarillo.value = cfg.vel_amarillo_cm_min;
    el.velRojo.value = cfg.vel_rojo_cm_min;
  } catch {
    mensaje('No se pudo cargar la configuración de este punto.');
  }
}

async function mostrarFormulario() {
  el.seccionLogin.hidden = true;
  el.seccionConfig.hidden = false;
  el.salir.hidden = MODO_DEMO;

  if (!puntos.length) {
    try {
      puntos = await obtenerPuntos();
    } catch {
      mensaje('No se pudieron cargar los puntos de monitoreo.');
      return;
    }
    el.punto.replaceChildren(...puntos.map((p) => {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = p.nombre;
      return o;
    }));
    try {
      const guardado = Number(localStorage.getItem('sa_punto'));
      if (puntos.some((p) => p.id === guardado)) el.punto.value = String(guardado);
    } catch { /* ignorar */ }
    el.punto.addEventListener('change', cargarValores);
  }
  await cargarValores();
}

function mostrarLogin() {
  el.seccionConfig.hidden = true;
  el.seccionLogin.hidden = false;
}

el.formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await iniciarSesion(el.correo.value.trim(), el.clave.value);
    el.clave.value = '';
    await mostrarFormulario();
  } catch {
    // Mensaje genérico a propósito: no revela si el correo existe.
    alert('Correo o contraseña incorrectos.');
  }
});

el.formConfig.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarMensaje();
  const cfg = {
    nivel_amarillo_cm: el.nivelAmarillo.valueAsNumber,
    nivel_rojo_cm: el.nivelRojo.valueAsNumber,
    vel_amarillo_cm_min: el.velAmarillo.valueAsNumber,
    vel_rojo_cm_min: el.velRojo.valueAsNumber,
  };
  el.guardar.disabled = true;
  try {
    await guardarConfig(Number(el.punto.value), cfg, el.altura.valueAsNumber);
    mensaje('Cambios guardados.', 'ok');
  } catch (err) {
    mensaje(err.message || 'No se pudieron guardar los cambios.');
  } finally {
    el.guardar.disabled = false;
  }
});

el.salir.addEventListener('click', async () => {
  await cerrarSesion();
  mostrarLogin();
});

async function iniciar() {
  if (MODO_DEMO) {
    el.notaDemo.hidden = false;
    await mostrarFormulario();
    return;
  }
  const usuario = await sesionActual();
  if (usuario) await mostrarFormulario();
  else mostrarLogin();
}

iniciar();
