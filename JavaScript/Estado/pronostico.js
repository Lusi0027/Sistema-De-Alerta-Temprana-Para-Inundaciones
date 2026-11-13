// =====================================================================
// Pronóstico de lluvia con Open-Meteo (gratuito, sin clave de API).
// Sirve como complemento: el sensor manda; la lluvia prevista solo avisa.
// Atribución requerida: Open-Meteo.com (ya está en el pie de página).
// =====================================================================

// San Pedro de Macorís (aprox.)
const LAT = 18.4539;
const LON = -69.3086;

const URL_API =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${LAT}&longitude=${LON}` +
  '&current=precipitation' +
  '&hourly=precipitation,precipitation_probability' +
  '&timezone=America%2FSanto_Domingo&forecast_days=2';

/** Intensidad según mm por hora (escala habitual de la OMM). */
export function clasificarLluvia(mmPorHora) {
  if (mmPorHora < 0.1) return 'Sin lluvia';
  if (mmPorHora < 2.5) return 'Lluvia ligera';
  if (mmPorHora < 7.6) return 'Lluvia moderada';
  return 'Lluvia intensa';
}

export async function obtenerPronostico() {
  const r = await fetch(URL_API);
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  const d = await r.json();

  const horaActual = String(d.current?.time ?? '').slice(0, 13); // "2026-11-12T20"
  let inicio = d.hourly.time.findIndex((t) => t.slice(0, 13) === horaActual);
  if (inicio < 0) inicio = 0;

  const horas = [];
  for (let i = inicio; i < Math.min(inicio + 12, d.hourly.time.length); i++) {
    horas.push({
      hora: d.hourly.time[i].slice(11, 16),
      mm: d.hourly.precipitation[i] ?? 0,
      prob: d.hourly.precipitation_probability?.[i] ?? null,
    });
  }
  return { actualMm: d.current?.precipitation ?? 0, horas };
}

/** Pinta el pronóstico en la tarjeta del panel. Nunca rompe el resto de la página. */
export async function cargarPronostico() {
  const resumen = document.getElementById('pron-resumen');
  const detalle = document.getElementById('pron-detalle');
  const barras = document.getElementById('pron-barras');
  const escala = document.getElementById('pron-escala');
  if (!resumen) return;

  try {
    const { horas } = await obtenerPronostico();
    const prox3 = horas.slice(0, 3);
    const maxMm3 = Math.max(0, ...prox3.map((h) => h.mm));
    const maxProb3 = Math.max(0, ...prox3.map((h) => h.prob ?? 0));
    const clase = clasificarLluvia(maxMm3);

    resumen.textContent = maxMm3 < 0.1
      ? 'Sin lluvia prevista en las próximas 3 horas'
      : `${clase} en las próximas 3 horas`;

    const maxMm12 = Math.max(0, ...horas.map((h) => h.mm));
    detalle.textContent =
      `Probabilidad máx. ${maxProb3} % · hasta ${maxMm12.toFixed(1)} mm/h en 12 h`;

    const escalaMax = Math.max(5, maxMm12);
    barras.replaceChildren(...horas.map((h) => {
      const b = document.createElement('div');
      b.className = 'barra';
      b.style.height = `${Math.round((h.mm / escalaMax) * 100)}%`;
      b.title = `${h.hora}: ${h.mm.toFixed(1)} mm`;
      return b;
    }));

    escala.replaceChildren(
      Object.assign(document.createElement('span'), { textContent: horas[0].hora }),
      Object.assign(document.createElement('span'), { textContent: horas[horas.length - 1].hora }),
    );
  } catch {
    resumen.textContent = 'Pronóstico no disponible';
    detalle.textContent = 'No se pudo consultar Open-Meteo. Las mediciones del sensor siguen funcionando.';
    barras.replaceChildren();
    escala.replaceChildren();
  }
}
