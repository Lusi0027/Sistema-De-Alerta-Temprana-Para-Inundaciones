# Sistema de alertas tempranas para inundaciones

Proyecto Integrador I · UCE · Grupo #2 · San Pedro de Macorís

Un sensor ultrasónico mide el nivel del agua, un ESP32 decide el color (verde, amarillo o rojo) según el **nivel** y la **velocidad de subida**, y un panel web muestra el estado en tiempo real, junto con el historial y el pronóstico de lluvia (Open-Meteo).

## Estructura

```
Assets/                 favicon
Css/                    estilos.css, semaforo.css
Html/
  index.html            panel principal (semáforo)
  Pronostico/           historial.html, configuracion.html
JavaScript/
  supabase-config.js    conexión (URL y clave anon)
  estado.js             regla verde/amarillo/rojo (lógica pura)
  datos.js              acceso a datos: Supabase o modo demo
  panel.js              lógica del panel
  Estado/               pronostico.js, historial.js, configuracion.js
Firmware/FloodSensor/   código del ESP32 (Arduino)
supabase-setup.sql      base de datos, seguridad y funciones
```

## 1. Verlo funcionando (modo demo, sin servidor)

Abre la carpeta en VS Code, clic derecho en `Html/index.html` → **Open with Live Server**.
(Los módulos de JavaScript no cargan abriendo el archivo con doble clic; hace falta un servidor local.)

Mientras `supabase-config.js` diga `PEGA_AQUI…`, la app usa datos simulados. Arriba aparecen botones para forzar **Normal / Precaución / Peligro**.

## 2. Conectar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: pega todo `supabase-setup.sql` y ejecútalo.
3. **Authentication → Users → Add user**: crea el usuario del operador. Luego, en el SQL Editor:
   ```sql
   insert into operadores (email) values ('correo-del-operador@ejemplo.com');
   ```
   Desactiva "Allow new users to sign up" en la configuración de Authentication.
4. **Project Settings → API**: copia la URL y la clave *anon* en `JavaScript/supabase-config.js`.
   Nunca uses la clave `service_role` en el navegador ni en el ESP32.
5. Registra el dispositivo (inventa un token de 32+ caracteres y guárdalo en `secrets.h`; aquí va solo su hash):
   ```sql
   insert into dispositivos (punto_id, token_hash, descripcion)
   values (
     (select id from puntos where nombre = 'Kennedy'),
     encode(extensions.digest('TU-TOKEN-LARGO-Y-ALEATORIO', 'sha256'), 'hex'),
     'ESP32 prototipo'
   );
   ```


## 3. Armar el ESP32

| Componente | Pin ESP32 | Nota |
|---|---|---|
| HC-SR04 VCC | 5 V (VIN) | |
| HC-SR04 GND | GND | |
| HC-SR04 TRIG | GPIO 5 | |
| HC-SR04 ECHO | GPIO 18 | **Con divisor de voltaje 1 kΩ / 2 kΩ**: el ECHO saca 5 V y el ESP32 tolera 3.3 V |
| LED verde | GPIO 25 | Resistencia de 220 Ω |
| LED amarillo | GPIO 26 | Resistencia de 220 Ω |
| LED rojo | GPIO 27 | Resistencia de 220 Ω |
| Zumbador activo | GPIO 14 | Suena intermitente en rojo |

1. Copia `Firmware/FloodSensor/secrets.example.h` como `secrets.h` y llénalo.
2. Ajusta `ALTURA_SENSOR_CM` (distancia del sensor al fondo con el cauce seco).
3. Arduino IDE → placa **ESP32 Dev Module** → subir.
4. Abre el Monitor Serie a 115200 para ver `dist`, `nivel`, `vel` y `estado`.

El semáforo local funciona sin WiFi. Si el sensor falla 3 veces seguidas, los tres LED parpadean.

## 4. Cómo se decide el color

- **Rojo:** nivel ≥ umbral rojo, o subida ≥ velocidad roja.
- **Amarillo:** nivel ≥ umbral amarillo, o subida ≥ velocidad amarilla.
- **Verde:** ninguna de las anteriores.

Valores iniciales: 20 / 40 cm y 2 / 5 cm/min (editables en **Ajustes**). Esta regla existe en tres sitios: `estado.js`, la función `registrar_lectura()` del SQL y el firmware. Si la cambias, cámbiala en los tres. En el panel, una lectura de hace más de 2 minutos se muestra como **Sin datos**, nunca como "todo bien".

## 5. Seguridad (para el requisito de rechazo de datos no autorizados)

- Las lecturas solo entran por `registrar_lectura()`: valida el token (se guarda su hash), el rango (2–400 cm) y limita la frecuencia (1 cada 5 s por punto). No hay INSERT público en la tabla.
- Cambiar umbrales exige sesión **y** estar en la tabla `operadores`.
- Las tablas `dispositivos` y `operadores` no son visibles por la API.
- Para probarlo: manda una lectura con un token inventado o un valor de 9999 cm y comprueba que el servidor la rechaza.

## 6. Validación (según la propuesta)

- **Error medio y error máximo (meta 0.5 cm):** compara la distancia que mide el sensor con una regla en 3 repeticiones por condición; la columna `distancia_cm` está en el CSV de **Historial → Descargar CSV**.
- **Tiempo de respuesta (meta 10 s):** mide desde que sube el agua hasta que cambia el LED; el ciclo de medición es de 10 s, así que ajusta `INTERVALO_MEDICION_MS` si hace falta.
- **Falsas alarmas:** cuenta en el historial las lecturas amarillas o rojas con el agua quieta.
- **Señal local sin conexión:** apaga el WiFi y comprueba que los LED siguen cambiando.

## Limitaciones conocidas

- El firmware usa `setInsecure()` (no valida el certificado del servidor): válido para el prototipo, no para una instalación real.
- El sensor no compensa temperatura (error del orden de 0.17 % por °C).
- El modo de bajo consumo del ESP32 y la alimentación solar quedan como mejora futura.
- Los datos meteorológicos son de [Open-Meteo.com](https://open-meteo.com/) (uso no comercial, con atribución).
