const fecha = document.getElementById('fecha-hoy');
if (fecha instanceof HTMLTimeElement) {
  const hoy = new Date();
  const texto = new Intl.DateTimeFormat('es-DO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Santo_Domingo',
  }).format(hoy);
  const partes = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Santo_Domingo',
  }).formatToParts(hoy);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));

  fecha.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
  fecha.dateTime = `${valores.year}-${valores.month}-${valores.day}`;
}