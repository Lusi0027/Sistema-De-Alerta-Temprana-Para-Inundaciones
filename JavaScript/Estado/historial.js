import { obtenerPuntos, obtenerHistorial, obtenerConfig } from '../datos.js';
import { CONFIG_POR_DEFECTO, ESTADOS, formatearFechaHoraCorta } from '../estado.js';

const $ = (id) => document.getElementById(id);
const el = {
  aviso: $('aviso'),
  punto: $('selector-punto'),
  rango: $('selector-rango'),
  actualizar: $('btn-actualizar'),
  csv: $('btn-csv'),
  nivelMax: $('est-nivel-max'),
  velMax: $('est-vel-max'),
  total: $('est-total'),
  alertas: $('est-alertas'),
  grafica: $('grafica'),
  tabla: $('tabla-lecturas'),
};

let puntos = [];
let lecturas = [];
let nombrePunto = 'punto';

function mostrarAviso(mensaje, tipo = 'error') {
  el.aviso.textContent = mensaje;
  el.aviso.className = tipo === 'info' ? 'aviso info' : 'aviso';
  el.aviso.hidden = false;
}

function limpiarAviso() {
  el.aviso.hidden = true;
}

function formatearNumero(valor) {
  return Number(valor).toLocaleString('es-DO', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function crearSvg(tag, atributos = {}) {
  const nodo = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor));
  return nodo;
}

function pintarGrafica(config) {
  if (!lecturas.length) {
    el.grafica.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'grafica-vacia',
      textContent: 'No hay lecturas para el período seleccionado.',
    }));
    return;
  }

  const ancho = 760;
  const alto = 270;
  const margen = { arriba: 18, derecha: 20, abajo: 36, izquierda: 48 };
  const anchoUtil = ancho - margen.izquierda - margen.derecha;
  const altoUtil = alto - margen.arriba - margen.abajo;
  const maxNivel = Math.max(10, ...lecturas.map((l) => Number(l.nivel_cm) || 0),
    config.nivel_rojo_cm) * 1.1;
  const x = (i) => margen.izquierda + (i / Math.max(lecturas.length - 1, 1)) * anchoUtil;
  const y = (valor) => margen.arriba + altoUtil - (valor / maxNivel) * altoUtil;
  const svg = crearSvg('svg', {
    viewBox: `0 0 ${ancho} ${alto}`,
    role: 'img',
    'aria-label': `Gráfica de nivel del agua con ${lecturas.length} lecturas`,
  });

  for (let i = 0; i <= 4; i++) {
    const valor = (maxNivel / 4) * i;
    const linea = crearSvg('line', {
      x1: margen.izquierda, y1: y(valor),
      x2: ancho - margen.derecha, y2: y(valor),
      class: 'rejilla',
    });
    const etiqueta = crearSvg('text', {
      x: margen.izquierda - 8, y: y(valor) + 4, 'text-anchor': 'end', class: 'eje',
    });
    etiqueta.textContent = formatearNumero(valor);
    svg.append(linea, etiqueta);
  }

  for (const [valor, clase, texto] of [
    [config.nivel_amarillo_cm, 'umbral-amarillo', 'Precaución'],
    [config.nivel_rojo_cm, 'umbral-rojo', 'Peligro'],
  ]) {
    if (valor <= maxNivel) {
      svg.append(crearSvg('line', {
        x1: margen.izquierda, y1: y(valor),
        x2: ancho - margen.derecha, y2: y(valor),
        class: clase,
      }));
      const etiqueta = crearSvg('text', {
        x: ancho - margen.derecha, y: y(valor) - 4,
        'text-anchor': 'end', class: clase === 'umbral-rojo' ? 'etq-rojo' : 'etq-amarillo',
      });
      etiqueta.textContent = `${texto} ${formatearNumero(valor)} cm`;
      svg.append(etiqueta);
    }
  }

  const paso = Math.max(1, Math.ceil(lecturas.length / 180));
  const muestras = lecturas
    .map((lectura, indice) => ({ lectura, indice }))
    .filter(({ indice }) => indice % paso === 0 || indice === lecturas.length - 1);
  const d = muestras.map(({ lectura, indice }, posicion) => {
    const coordX = x(indice);
    const coordY = y(Number(lectura.nivel_cm) || 0);
    return `${posicion === 0 ? 'M' : 'L'}${coordX.toFixed(1)},${coordY.toFixed(1)}`;
  }).join(' ');
  svg.append(crearSvg('path', { d, class: 'linea-nivel' }));

  for (const indice of [0, lecturas.length - 1]) {
    const punto = lecturas[indice];
    svg.append(crearSvg('circle', {
      cx: x(indice), cy: y(Number(punto.nivel_cm) || 0), r: 3, class: 'punto-nivel',
    }));
  }

  for (const indice of [0, lecturas.length - 1]) {
    const etiqueta = crearSvg('text', {
      x: x(indice), y: alto - 8,
      'text-anchor': indice === 0 ? 'start' : 'end', class: 'eje',
    });
    etiqueta.textContent = formatearFechaHoraCorta(lecturas[indice].creado_en);
    svg.append(etiqueta);
  }
  el.grafica.replaceChildren(svg);
}

function pintarTabla() {
  const filas = lecturas.slice(-100).reverse().map((lectura) => {
    const fila = document.createElement('tr');
    const fecha = document.createElement('td');
    fecha.textContent = formatearFechaHoraCorta(lectura.creado_en);
    const nivel = document.createElement('td');
    nivel.textContent = formatearNumero(lectura.nivel_cm);
    const velocidad = document.createElement('td');
    velocidad.textContent = formatearNumero(lectura.velocidad_cm_min);
    const estado = document.createElement('td');
    const pill = document.createElement('span');
    const clave = ESTADOS[lectura.estado] ? lectura.estado : 'desconocido';
    pill.className = 'pill pill-chica';
    pill.dataset.estado = clave;
    pill.textContent = ESTADOS[clave].etiqueta;
    estado.append(pill);
    fila.append(fecha, nivel, velocidad, estado);
    return fila;
  });
  el.tabla.replaceChildren(...filas);
}

function pintarResumen() {
  const maxNivel = lecturas.length ? Math.max(...lecturas.map((l) => Number(l.nivel_cm) || 0)) : null;
  const maxVelocidad = lecturas.length ? Math.max(0, ...lecturas.map((l) => Number(l.velocidad_cm_min) || 0)) : null;
  el.nivelMax.textContent = maxNivel === null ? '--' : formatearNumero(maxNivel);
  el.velMax.textContent = maxVelocidad === null ? '--' : formatearNumero(maxVelocidad);
  el.total.textContent = String(lecturas.length);
  el.alertas.textContent = String(lecturas.filter((l) => l.estado === 'amarillo' || l.estado === 'rojo').length);
}

function descargarCsv() {
  if (!lecturas.length) return;
  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const filas = [
    ['fecha', 'distancia_cm', 'nivel_cm', 'velocidad_cm_min', 'estado'],
    ...lecturas.map((l) => [l.creado_en, l.distancia_cm, l.nivel_cm, l.velocidad_cm_min, l.estado]),
  ];
  const contenido = `\uFEFF${filas.map((fila) => fila.map(escapar).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `historial-${nombrePunto.replace(/[^a-z0-9-]/gi, '-')}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function cargar() {
  if (!el.punto.value) return;
  limpiarAviso();
  el.actualizar.disabled = true;
  el.csv.disabled = true;
  nombrePunto = puntos.find((p) => String(p.id) === el.punto.value)?.nombre || 'punto';

  try {
    const desdeMs = Date.now() - Number(el.rango.value) * 60 * 60 * 1000;
    lecturas = await obtenerHistorial(Number(el.punto.value), desdeMs);
    let config = CONFIG_POR_DEFECTO;
    try {
      config = await obtenerConfig(Number(el.punto.value));
    } catch (error) {
      mostrarAviso(`No se pudieron cargar los umbrales del punto: ${error.message || 'error de conexión'}`, 'info');
    }
    pintarResumen();
    pintarGrafica(config);
    pintarTabla();
    el.csv.disabled = lecturas.length === 0;
  } catch (error) {
    mostrarAviso(`No se pudo cargar el historial: ${error.message || 'error de conexión'}`);
    lecturas = [];
    pintarResumen();
    pintarGrafica(CONFIG_POR_DEFECTO);
    pintarTabla();
  } finally {
    el.actualizar.disabled = false;
  }
}

async function iniciar() {
  try {
    puntos = await obtenerPuntos();
    if (!puntos.length) {
      el.punto.replaceChildren(new Option('No hay puntos activos', ''));
      mostrarAviso('No hay puntos de medición activos configurados.');
      return;
    }
    el.punto.replaceChildren(...puntos.map((p) => new Option(p.nombre, String(p.id))));
    try {
      const guardado = localStorage.getItem('sa_punto');
      if (puntos.some((p) => String(p.id) === guardado)) el.punto.value = guardado;
    } catch { /* Se usa el primer punto si el almacenamiento no está disponible. */ }
    el.punto.disabled = false;
    el.punto.addEventListener('change', cargar);
    el.rango.addEventListener('change', cargar);
    el.actualizar.addEventListener('click', cargar);
    el.csv.addEventListener('click', descargarCsv);
    await cargar();
  } catch (error) {
    el.punto.replaceChildren(new Option('Puntos no disponibles', ''));
    mostrarAviso(`No se pudieron cargar los puntos de monitoreo: ${error.message || 'error de conexión'}`);
  }
}

iniciar();
