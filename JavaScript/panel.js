import { MODO_DEMO } from './supabase-config.js';
import {
  obtenerPuntos, ultimaLectura, ultimasLecturas, suscribirLecturas,
  escenarioDemo, fijarEscenarioDemo,
} from './datos.js';
import { ESTADOS, esLecturaVigente, textoEdad } from './estado.js';
import { cargarPronostico } from './Estado/pronostico.js';

const $ = (id) => document.getElementById(id);
const el = {
  aviso: $('aviso'),
  selector: $('selector-punto'),
  semaforo: $('semaforo'),
  estado: $('estado-pill'),
  detalle: $('estado-detalle'),
  nivel: $('dato-nivel'),
  velocidad: $('dato-velocidad'),
  lecturas: $('lecturas'),
  hora: $('dato-hora'),
  lista: $('lista-puntos'),
  demo: $('demo-bar'),
  demoBotones: $('demo-botones'),
};

let puntos = [];
let lecturaActual = null;
let cancelarSuscripcion = null;

function mostrarAviso(mensaje) {
  el.aviso.textContent = mensaje;
  el.aviso.hidden = false;
}

function estadoDe(lectura) {
  return esLecturaVigente(lectura) && ESTADOS[lectura.estado]
    ? lectura.estado
    : 'desconocido';
}

function pintarLectura(lectura) {
  lecturaActual = lectura;
  const estado = estadoDe(lectura);
  const info = ESTADOS[estado];
  el.semaforo.dataset.estado = estado;
  el.semaforo.setAttribute('aria-label', `Semáforo: ${info.etiqueta}`);
  el.estado.dataset.estado = estado;
  el.estado.textContent = info.etiqueta;
  el.detalle.textContent = info.detalle;

  const vigente = estado !== 'desconocido';
  el.nivel.textContent = vigente ? Number(lectura.nivel_cm).toFixed(1) : '--';
  el.velocidad.textContent = vigente ? Number(lectura.velocidad_cm_min).toFixed(2) : '--';
  el.lecturas.classList.toggle('vencida', !vigente);
  actualizarHora();
}

function actualizarHora() {
  if (!lecturaActual) {
    el.hora.textContent = 'Sin lecturas';
    return;
  }
  el.hora.textContent = `Última lectura ${textoEdad(Date.now() - new Date(lecturaActual.creado_en).getTime())}`;
  if (estadoDe(lecturaActual) === 'desconocido') {
    el.hora.textContent = 'Lectura antigua; esperando datos recientes';
    el.semaforo.dataset.estado = 'desconocido';
    el.estado.dataset.estado = 'desconocido';
    el.estado.textContent = ESTADOS.desconocido.etiqueta;
    el.detalle.textContent = ESTADOS.desconocido.detalle;
    el.nivel.textContent = '--';
    el.velocidad.textContent = '--';
    el.lecturas.classList.add('vencida');
  }
}

function pintarLista(lecturas) {
  const porPunto = new Map(lecturas.map((lectura) => [String(lectura.punto_id), lectura]));
  el.lista.replaceChildren(...puntos.map((punto) => {
    const lectura = porPunto.get(String(punto.id));
    const estado = estadoDe(lectura);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'punto-item';
    boton.setAttribute('aria-current', String(String(punto.id) === el.selector.value));
    boton.setAttribute('aria-label', `${punto.nombre}: ${ESTADOS[estado].etiqueta}`);

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.estado = estado;
    dot.setAttribute('aria-hidden', 'true');
    const nombre = document.createElement('span');
    nombre.className = 'punto-nombre';
    nombre.textContent = punto.nombre;
    const etiqueta = document.createElement('span');
    etiqueta.className = 'punto-estado';
    etiqueta.textContent = ESTADOS[estado].etiqueta;
    boton.append(dot, nombre, etiqueta);
    boton.addEventListener('click', () => {
      el.selector.value = String(punto.id);
      seleccionarPunto();
    });
    return boton;
  }));
}

async function actualizarLista() {
  try {
    pintarLista(await ultimasLecturas());
  } catch (error) {
    mostrarAviso(`No se pudo actualizar la lista de puntos: ${error.message || 'error de conexión'}`);
  }
}

function iniciarSuscripcion(puntoId) {
  if (cancelarSuscripcion) cancelarSuscripcion();
  cancelarSuscripcion = suscribirLecturas(puntoId, pintarLectura);
}

async function seleccionarPunto() {
  const puntoId = el.selector.value;
  if (!puntoId) return;
  try {
    localStorage.setItem('sa_punto', puntoId);
  } catch { /* El panel sigue funcionando si el navegador bloquea el almacenamiento. */ }

  iniciarSuscripcion(puntoId);
  try {
    pintarLectura(await ultimaLectura(Number(puntoId)));
    el.aviso.hidden = true;
    await actualizarLista();
  } catch (error) {
    mostrarAviso(`No se pudo cargar la lectura: ${error.message || 'error de conexión'}`);
    pintarLectura(null);
  }
}

function prepararDemo() {
  el.demo.hidden = false;
  const opciones = [
    { valor: 'auto', texto: 'Automático' },
    { valor: 'verde', texto: 'Normal' },
    { valor: 'amarillo', texto: 'Precaución' },
    { valor: 'rojo', texto: 'Peligro' },
  ];
  el.demoBotones.replaceChildren(...opciones.map(({ valor, texto }) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = texto;
    boton.setAttribute('aria-pressed', String(escenarioDemo() === valor));
    boton.addEventListener('click', () => {
      fijarEscenarioDemo(valor);
      prepararDemo();
      seleccionarPunto();
    });
    return boton;
  }));
}

async function iniciar() {
  if (MODO_DEMO) prepararDemo();
  cargarPronostico();

  try {
    puntos = await obtenerPuntos();
    if (!puntos.length) {
      el.selector.replaceChildren(new Option('No hay puntos activos', ''));
      mostrarAviso('No hay puntos de medición activos configurados.');
      return;
    }

    el.selector.replaceChildren(...puntos.map((punto) => new Option(punto.nombre, String(punto.id))));
    try {
      const guardado = localStorage.getItem('sa_punto');
      if (puntos.some((punto) => String(punto.id) === guardado)) el.selector.value = guardado;
    } catch { /* Se usa el primer punto si el almacenamiento no está disponible. */ }
    el.selector.disabled = false;
    el.selector.addEventListener('change', seleccionarPunto);
    await seleccionarPunto();
    await actualizarLista();
    window.setInterval(actualizarHora, 10000);
    window.setInterval(actualizarLista, 15000);
  } catch (error) {
    el.selector.replaceChildren(new Option('Puntos no disponibles', ''));
    mostrarAviso(`No se pudieron cargar los puntos de monitoreo: ${error.message || 'error de conexión'}`);
  }
}

iniciar();
