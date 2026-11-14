/*
  Sistema de alerta temprana para inundaciones — firmware del prototipo (ESP32)

  - Mide la distancia al agua con un HC-SR04 (mediana de 5 muestras).
  - Calcula nivel y velocidad de subida, y decide verde / amarillo / rojo
    LOCALMENTE: el semáforo funciona aunque no haya WiFi ni internet.
  - Envía cada lectura a Supabase con el token del dispositivo.
    El servidor valida el token y recalcula el estado con los umbrales
    guardados en la base de datos.

  Antes de compilar: copia secrets.example.h a secrets.h y llénalo.
  Placa: "ESP32 Dev Module" (Arduino IDE con el paquete esp32 instalado).

  ¡IMPORTANTE! El pin ECHO del HC-SR04 entrega 5 V y el ESP32 tolera 3.3 V.
  Usa un divisor de voltaje (1 kΩ del ECHO al pin y 2 kΩ del pin a GND) o un
  módulo compatible con 3.3 V (HC-SR04P).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "secrets.h"

// ------------------------- Pines -------------------------
const int PIN_TRIG         = 5;
const int PIN_ECHO         = 18;   // con divisor de voltaje
const int PIN_LED_VERDE    = 25;   // cada LED con resistencia de 220 Ω
const int PIN_LED_AMARILLO = 26;
const int PIN_LED_ROJO     = 27;
const int PIN_BUZZER       = 14;   // zumbador activo

// ------------------ Calibración y umbrales ------------------
// Deben coincidir con los de la página de Ajustes (el servidor usa los suyos).
const float ALTURA_SENSOR_CM    = 100.0;  // distancia del sensor al fondo, con el cauce seco
const float NIVEL_AMARILLO_CM   = 20.0;
const float NIVEL_ROJO_CM       = 40.0;
const float VEL_AMARILLO_CM_MIN = 2.0;
const float VEL_ROJO_CM_MIN     = 5.0;
const bool  BUZZER_ACTIVO       = true;

// ------------------------- Tiempos -------------------------
const unsigned long INTERVALO_MEDICION_MS      = 10000UL;  // mide cada 10 s
const unsigned long INTERVALO_ENVIO_NORMAL_MS  = 60000UL;  // en verde, envía cada 60 s
const unsigned long INTERVALO_ENVIO_ALERTA_MS  = 10000UL;  // en amarillo/rojo, cada 10 s
const unsigned long REINTENTO_WIFI_MS          = 30000UL;

// ------------------------- Estado -------------------------
enum Estado { VERDE, AMARILLO, ROJO, ERROR_SENSOR };
Estado estadoActual = VERDE;

struct Muestra { unsigned long t; float nivel; };
const int N_HIST = 24;               // 24 muestras x 10 s = 4 min de historia
Muestra hist[N_HIST];
int histN = 0;
int histPos = 0;

int fallosSeguidos = 0;
unsigned long ultimaMedicion = 0;
unsigned long ultimoEnvio = 0;
bool primeraVez = true;

// ===================== Medición =====================
float lecturaUnica() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long duracion = pulseIn(PIN_ECHO, HIGH, 30000UL);  // tope ~5 m
  if (duracion == 0) return NAN;
  return duracion * 0.0343f / 2.0f;  // velocidad del sonido a ~20 °C
}

// Mediana de 5 muestras: descarta lecturas sueltas erróneas (gotas, insectos, rebotes).
float medirDistanciaCm() {
  float v[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    float d = lecturaUnica();
    if (!isnan(d) && d >= 2.0f && d <= 400.0f) v[n++] = d;
    delay(60);
  }
  if (n < 3) return NAN;
  for (int i = 1; i < n; i++) {            // ordenar (inserción)
    float x = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
  return v[n / 2];
}

// Velocidad de subida (cm/min) contra la muestra más reciente de hace >= 60 s.
float calcularVelocidad(float nivelActual) {
  unsigned long ahora = millis();
  for (int k = 1; k <= histN; k++) {
    int idx = (histPos - k + N_HIST) % N_HIST;
    unsigned long edad = ahora - hist[idx].t;
    if (edad >= 60000UL && edad <= 600000UL) {
      return (nivelActual - hist[idx].nivel) / (edad / 60000.0f);
    }
  }
  return 0.0f;
}

void guardarMuestra(float nivel) {
  hist[histPos] = { millis(), nivel };
  histPos = (histPos + 1) % N_HIST;
  if (histN < N_HIST) histN++;
}

Estado decidirEstado(float nivel, float vel) {
  if (nivel >= NIVEL_ROJO_CM || vel >= VEL_ROJO_CM_MIN) return ROJO;
  if (nivel >= NIVEL_AMARILLO_CM || vel >= VEL_AMARILLO_CM_MIN) return AMARILLO;
  return VERDE;
}

// ===================== Salidas =====================
void actualizarSalidas() {
  unsigned long ahora = millis();
  if (estadoActual == ERROR_SENSOR) {
    bool on = (ahora / 400) % 2 == 0;      // los tres LED parpadean: falla del sensor
    digitalWrite(PIN_LED_VERDE, on);
    digitalWrite(PIN_LED_AMARILLO, on);
    digitalWrite(PIN_LED_ROJO, on);
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  digitalWrite(PIN_LED_VERDE,    estadoActual == VERDE);
  digitalWrite(PIN_LED_AMARILLO, estadoActual == AMARILLO);
  digitalWrite(PIN_LED_ROJO,     estadoActual == ROJO);
  bool pita = BUZZER_ACTIVO && estadoActual == ROJO && (ahora / 500) % 2 == 0;
  digitalWrite(PIN_BUZZER, pita);
}

void pruebaDeLuces() {
  const int leds[3] = { PIN_LED_VERDE, PIN_LED_AMARILLO, PIN_LED_ROJO };
  for (int i = 0; i < 3; i++) {
    digitalWrite(leds[i], HIGH);
    delay(300);
    digitalWrite(leds[i], LOW);
  }
}

// ===================== Red =====================
void gestionarWiFi() {
  static unsigned long ultimoIntento = 0;
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - ultimoIntento < REINTENTO_WIFI_MS) return;
  ultimoIntento = millis();
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool enviarLectura(float distanciaCm) {
  if (WiFi.status() != WL_CONNECTED) return false;

  // OJO: setInsecure() no valida el certificado del servidor. Sirve para el
  // prototipo; en una instalación real usa client.setCACert(...) con la CA raíz.
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(5000);
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/registrar_lectura";
  if (!http.begin(client, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  if (String(SUPABASE_ANON_KEY).startsWith("eyJ")) {   // clave anon clásica (JWT)
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  }

  String cuerpo = String("{\"p_token\":\"") + DEVICE_TOKEN +
                  "\",\"p_distancia_cm\":" + String(distanciaCm, 1) + "}";
  int codigo = http.POST(cuerpo);
  Serial.printf("Envio -> HTTP %d\n", codigo);
  http.end();
  return codigo >= 200 && codigo < 300;
}

// ===================== Arduino =====================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMARILLO, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pruebaDeLuces();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000UL) delay(250);
  Serial.println(WiFi.status() == WL_CONNECTED ? "WiFi conectado" : "Sin WiFi: modo local");
}

void loop() {
  unsigned long ahora = millis();
  gestionarWiFi();

  if (primeraVez || ahora - ultimaMedicion >= INTERVALO_MEDICION_MS) {
    ultimaMedicion = ahora;
    float distancia = medirDistanciaCm();

    if (isnan(distancia)) {
      if (++fallosSeguidos >= 3) estadoActual = ERROR_SENSOR;
      Serial.println("Medicion invalida");
    } else {
      fallosSeguidos = 0;
      float nivel = ALTURA_SENSOR_CM - distancia;
      if (nivel < 0) nivel = 0;
      float vel = calcularVelocidad(nivel);
      guardarMuestra(nivel);
      estadoActual = decidirEstado(nivel, vel);
      Serial.printf("dist=%.1f cm  nivel=%.1f cm  vel=%.2f cm/min  estado=%d\n",
                    distancia, nivel, vel, (int)estadoActual);

      unsigned long intervalo = (estadoActual == VERDE) ? INTERVALO_ENVIO_NORMAL_MS
                                                         : INTERVALO_ENVIO_ALERTA_MS;
      if (primeraVez || ahora - ultimoEnvio >= intervalo) {
        if (enviarLectura(distancia)) ultimoEnvio = millis();
      }
    }
    primeraVez = false;
  }

  actualizarSalidas();
}
