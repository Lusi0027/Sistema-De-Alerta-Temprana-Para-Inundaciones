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
    const prox6 = horas.slice(0, 6);
    const maxMm6 = Math.max(0, ...prox6.map((h) => h.mm));
    const maxProb6 = Math.max(0, ...prox6.map((h) => h.prob ?? 0));
    const clase = clasificarLluvia(maxMm6);

    resumen.textContent = maxMm6 < 0.1
      ? 'Sin lluvia prevista en las próximas 6 horas'
      : `${clase} en las próximas 6 horas`;

    detalle.textContent =
      `Probabilidad máx. ${maxProb6} % · hasta ${maxMm6.toFixed(1)} mm/h en 6 h`;

    const escalaMax = maxMm6 || 1;
    barras.replaceChildren(...prox6.map((h) => {
      const columna = document.createElement('div');
      columna.className = 'pron-columna';
      columna.setAttribute('role', 'listitem');
      columna.title = `${h.hora}: ${h.mm.toFixed(1)} mm/h`;

      const valor = Object.assign(document.createElement('span'), {
        className: 'pron-valor',
        textContent: `${h.mm.toFixed(1)} mm`,
      });
      const pista = document.createElement('div');
      pista.className = 'pron-track';
      const barra = document.createElement('span');
      barra.className = 'barra';
      barra.style.height = h.mm > 0
        ? `${Math.max(5, Math.round((h.mm / escalaMax) * 100))}%`
        : '0';
      pista.append(barra);

      const hora = Object.assign(document.createElement('span'), {
        className: 'pron-hora',
        textContent: h.hora,
      });
      columna.append(valor, pista, hora);
      return columna;
    }));

    escala.textContent = 'Precipitación por hora · altura relativa al máximo previsto';
  } catch {
    resumen.textContent = 'Pronóstico no disponible';
    detalle.textContent = 'No se pudo consultar Open-Meteo. Las mediciones del sensor siguen funcionando.';
    barras.replaceChildren();
    escala.replaceChildren();
  }
}
