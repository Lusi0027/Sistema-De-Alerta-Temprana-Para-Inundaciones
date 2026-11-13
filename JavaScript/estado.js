// =====================================================================
// Lógica pura de estados: no toca el DOM ni la red.
// La MISMA regla está en la función SQL registrar_lectura() y en el
// firmware del ESP32; si cambias una, cambia las tres.
// =====================================================================

// Una lectura más vieja que esto se considera "sin señal".
export const MAX_EDAD_LECTURA_MS = 2 * 60 * 1000;

export const CONFIG_POR_DEFECTO = Object.freeze({
  nivel_amarillo_cm: 20,
  nivel_rojo_cm: 40,
  vel_amarillo_cm_min: 2,
  vel_rojo_cm_min: 5,
});

export const ESTADOS = {
  verde: {
    etiqueta: 'Normal',
    detalle: 'Sin riesgo de inundación en este punto.',
  },
  amarillo: {
    etiqueta: 'Precaución',
    detalle: 'El agua está subiendo. Esté atento a nuevas alertas.',
  },
  rojo: {
    etiqueta: 'Peligro',
    detalle: 'Nivel alto o subida rápida. Aléjese de la zona inundable.',
  },
  desconocido: {
    etiqueta: 'Sin datos',
    detalle: 'No hay lecturas recientes de este punto. No asuma que no hay riesgo.',
  },
};

/** Nivel del agua desde el fondo = altura del sensor − distancia medida (mínimo 0). */
export function calcularNivel(distanciaCm, alturaSensorCm) {
  return Math.max(0, Math.round((alturaSensorCm - distanciaCm) * 10) / 10);
}

/** 'verde' | 'amarillo' | 'rojo' según nivel (cm) y velocidad de subida (cm/min). */
export function calcularEstado(nivel, velocidad, cfg = CONFIG_POR_DEFECTO) {
  if (nivel >= cfg.nivel_rojo_cm || velocidad >= cfg.vel_rojo_cm_min) return 'rojo';
  if (nivel >= cfg.nivel_amarillo_cm || velocidad >= cfg.vel_amarillo_cm_min) return 'amarillo';
  return 'verde';
}

/**
 * Velocidad de subida (cm/min) de una serie ordenada de más vieja a más nueva.
 * Compara la última lectura con la más reciente que tenga al menos 1 minuto
 * de antigüedad (y no más de 10). Si no hay, devuelve 0.
 */
export function calcularVelocidad(serie) {
  if (!serie || serie.length < 2) return 0;
  const ultima = serie[serie.length - 1];
  const tUltima = new Date(ultima.creado_en).getTime();
  for (let i = serie.length - 2; i >= 0; i--) {
    const dt = (tUltima - new Date(serie[i].creado_en).getTime()) / 60000;
    if (dt >= 1) {
      if (dt > 10) return 0;
      return Math.round(((ultima.nivel_cm - serie[i].nivel_cm) / dt) * 100) / 100;
    }
  }
  return 0;
}

export function edadMs(iso) {
  return Date.now() - new Date(iso).getTime();
}

export function esLecturaVigente(lectura) {
  return !!lectura && edadMs(lectura.creado_en) <= MAX_EDAD_LECTURA_MS;
}

export function textoEdad(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Versión compacta para tablas: "12/11 8:54 p. m." */
export function formatearFechaHoraCorta(iso) {
  return new Date(iso).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit',
  });
}

export function formatearFechaHora(iso) {
  return new Date(iso).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
