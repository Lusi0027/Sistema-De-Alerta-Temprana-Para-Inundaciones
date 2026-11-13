import { MODO_DEMO } from './supabase-config.js';
import {
  obtenerPuntos, ultimaLectura, ultimasLecturas, suscribirLecturas,
  escenarioDemo, fijarEscenarioDemo, PUNTOS_PROXIMAMENTE,
} from './datos.js';
import { ESTADOS, esLecturaVigente, textoEdad } from './estado.js';
import { cargarPronostico } from './Estado/pronostico.js';

const $ = (id) => document.getElementById(id);
const el = {
  aviso: $('aviso'),
  alertaRiesgo: $('alerta-riesgo'),
  notificaciones: $('estado-notificaciones'),
  activarNotificaciones: $('btn-notificaciones'),
  selector: $('selector-punto'),
  semaforo: $('semaforo'),
  estadoCard: $('estado-card'),
  estado: $('estado-pill'),
  detalle: $('estado-detalle'),
  nivel: $('dato-nivel'),
  medidor: $('medidor-nivel'),
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
let ultimaNotificacion = null;

function mostrarAviso(mensaje) {
  el.aviso.textContent = mensaje;
  el.aviso.hidden = false;
}

function actualizarEstadoNotificaciones() {
  const boton = el.activarNotificaciones;
  if (!('Notification' in window)) {
    boton.hidden = true;
    el.notificaciones.textContent = 'Este navegador no admite notificaciones.';
    return;
  }
  if (!window.isSecureContext) {
    boton.hidden = true;
    el.notificaciones.textContent = 'Las notificaciones requieren HTTPS o abrir la app en localhost.';
    return;
  }

  const permiso = window.Notification.permission;
  if (permiso === 'granted') {
    boton.hidden = true;
    el.notificaciones.textContent = 'Notificaciones activadas. Recibirás avisos de Precaución y Peligro.';
  } else if (permiso === 'denied') {
    boton.disabled = true;
    boton.textContent = 'Notificaciones bloqueadas';
    el.notificaciones.textContent = 'Permite las notificaciones de este sitio desde la configuración del navegador.';
  } else {
    boton.disabled = false;
    boton.textContent = 'Activar notificaciones';
    el.notificaciones.textContent = 'Activa las notificaciones para recibir avisos de riesgo en este dispositivo.';
  }
}

async function solicitarNotificaciones() {
  try {
    await window.Notification.requestPermission();
    actualizarEstadoNotificaciones();
    if (window.Notification.permission === 'granted' && lecturaActual) {
      actualizarAlertaRiesgo(estadoDe(lecturaActual));
    }
  } catch (error) {
    el.notificaciones.textContent = `No se pudieron activar las notificaciones: ${error.message || 'error del navegador'}`;
  }
}

function emitirNotificacion(estado, mensaje) {
  if (!window.isSecureContext || !('Notification' in window)
      || window.Notification.permission !== 'granted') return;

  const puntoId = el.selector.value;
  const clave = `${puntoId}:${estado}`;
  if (clave === ultimaNotificacion) return;
  ultimaNotificacion = clave;

  try {
    new window.Notification(
      estado === 'rojo' ? 'Peligro de inundación' : 'Precaución por inundación',
      {
        body: mensaje,
        icon: new URL('../Assets/favicon.svg', window.location.href).href,
        tag: `alerta-inundacion-${puntoId}`,
        renotify: true,
      },
    );
  } catch (error) {
    el.notificaciones.textContent = `No se pudo mostrar la notificación: ${error.message || 'error del navegador'}`;
  }
}

function actualizarAlertaRiesgo(estado) {
  if (estado !== 'amarillo' && estado !== 'rojo') {
    el.alertaRiesgo.hidden = true;
    el.alertaRiesgo.textContent = '';
    delete el.alertaRiesgo.dataset.estado;
    ultimaNotificacion = null;
    return;
  }

  const punto = puntos.find((item) => String(item.id) === el.selector.value);
  const nombre = punto ? punto.nombre : 'este punto';
  const mensaje = estado === 'rojo'
    ? `Peligro de inundación en ${nombre}. Aléjate del cauce y sigue las indicaciones de las autoridades.`
    : `Precaución en ${nombre}: el nivel del agua está elevado. Evita acercarte al cauce y mantente atento a las indicaciones oficiales.`;

  el.alertaRiesgo.dataset.estado = estado;
  if (el.alertaRiesgo.textContent !== mensaje) el.alertaRiesgo.textContent = mensaje;
  el.alertaRiesgo.hidden = false;
  emitirNotificacion(estado, mensaje);
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
  el.estadoCard.dataset.estado = estado;
  el.semaforo.setAttribute('aria-label', `Semáforo: ${info.etiqueta}`);
  el.estado.dataset.estado = estado;
  el.estado.textContent = info.etiqueta;
  el.detalle.textContent = info.detalle;
  actualizarAlertaRiesgo(estado);

  const vigente = estado !== 'desconocido';
  el.nivel.textContent = vigente ? Number(lectura.nivel_cm).toFixed(1) : '--';
  el.medidor.style.height = vigente
    ? `${Math.max(0, Math.min(100, (Number(lectura.nivel_cm) / 40) * 100))}%`
    : '0%';
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
    el.estadoCard.dataset.estado = 'desconocido';
    el.estado.dataset.estado = 'desconocido';
    el.estado.textContent = ESTADOS.desconocido.etiqueta;
    el.detalle.textContent = ESTADOS.desconocido.detalle;
    actualizarAlertaRiesgo('desconocido');
    el.nivel.textContent = '--';
    el.medidor.style.height = '0%';
    el.velocidad.textContent = '--';
    el.lecturas.classList.add('vencida');
  }
}

function pintarLista(lecturas) {
  const porPunto = new Map(lecturas.map((lectura) => [String(lectura.punto_id), lectura]));
  const botonesActivos = puntos.map((punto) => {
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
  });
  const botonesProximamente = PUNTOS_PROXIMAMENTE.map((nombre) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'punto-item punto-proximamente';
    boton.disabled = true;
    boton.setAttribute('aria-label', `${nombre}: Próximamente`);

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    const etiquetaNombre = document.createElement('span');
    etiquetaNombre.className = 'punto-nombre';
    etiquetaNombre.textContent = nombre;
    const etiquetaEstado = document.createElement('span');
    etiquetaEstado.className = 'punto-estado';
    etiquetaEstado.textContent = 'Próximamente';
    boton.append(dot, etiquetaNombre, etiquetaEstado);
    return boton;
  });
  el.lista.replaceChildren(...botonesActivos, ...botonesProximamente);
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
  el.activarNotificaciones.addEventListener('click', solicitarNotificaciones);
  actualizarEstadoNotificaciones();
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
