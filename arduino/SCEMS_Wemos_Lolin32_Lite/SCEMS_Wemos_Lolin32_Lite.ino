/*
  SCEMS - WEMOS LOLIN32 LITE full sensor test sketch

  Components:
  - WEMOS LOLIN32 LITE / ESP32
  - 1.3 inch I2C OLED display
  - GY-906 MLX90614 IR temperature sensor
  - MH-ET LIVE MAX30102 heart sensor
  - HW-123 / MPU6050 fall detector
  - NEO-6M GPS module

  Wiring summary:
  - I2C SDA: GPIO19
  - I2C SCL/SCK: GPIO23
  - GPS TX -> ESP32 GPIO16
  - GPS RX -> ESP32 GPIO17
  - All VCC/VIN/VDD -> ESP32 3V pin
  - All GND pins together

  Networking:
  - Requires the "ArduinoJson" library (v7+) in addition to the sensor libs above.
  - Fill in WIFI_SSID / WIFI_PASSWORD / INGEST_URL / DEVICE_ID below before flashing.
  - INGEST_URL must point at the LAN IP of the machine running server.js, e.g.
    "http://192.168.1.50:3000/api/ingest" - "localhost" will not work here since
    the ESP32 is a separate device on the network.
  - DEVICE_ID must exactly match the "device_id" field on the patient's document
    in the Firestore "patients" collection, or the backend will reject readings
    with 404 "No patient registered for device_id".
*/

#include <Wire.h>
#include <U8g2lib.h>
#include <TinyGPSPlus.h>
#include <Adafruit_MLX90614.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <math.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ESP32 pin choices for WEMOS LOLIN32 LITE.
const int I2C_SDA_PIN = 19;
const int I2C_SCL_PIN = 23;
const int GPS_RX_PIN = 16;      // ESP32 RX: connect GPS TX here
const int GPS_TX_PIN = 17;      // ESP32 TX: connect GPS RX here

const uint32_t SERIAL_BAUD = 115200;
const uint32_t GPS_BAUD = 9600;

// Temperature warning threshold. Adjust after testing with your sensor.
const float FEVER_TEMP_C = 38.0;

// MLX90614 object temperature often needs calibration depending on distance.
const float BODY_TEMP_OFFSET_C = 0.0;

// Simple fall detection thresholds.
const float FREE_FALL_G = 0.45;
const float IMPACT_G = 2.50;
const float HARD_IMPACT_G = 3.20;
const unsigned long IMPACT_WINDOW_MS = 1200;
const unsigned long FALL_ALERT_MS = 10000;

// ---- WiFi & backend configuration: fill these in before flashing ----
const char *WIFI_SSID = "REDMI Note 15 Pro+ 5G";
const char *WIFI_PASSWORD = "wovsilva2005";
const char *INGEST_URL = "http://10.136.101.10:3000/api/ingest";
const char *DEVICE_ID = "SECMS-ESP32-001";

// How often to POST a telemetry reading. Kept fairly infrequent because each
// POST blocks the loop for up to HTTP_TIMEOUT_MS if the network is slow -
// too short an interval would start starving readMotion()'s fall-detection
// polling.
const unsigned long INGEST_INTERVAL_MS = 8000;
const uint16_t HTTP_TIMEOUT_MS = 4000;

// 1.3 inch I2C OLEDs are commonly SH1106. If your OLED stays blank, try the
// SSD1306 constructor shown below instead.
U8G2_SH1106_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
// U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);

Adafruit_MLX90614 mlx = Adafruit_MLX90614();
Adafruit_MPU6050 mpu;
MAX30105 heartSensor;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

bool mlxReady = false;
bool mpuReady = false;
bool heartReady = false;

float bodyTempC = NAN;
float ambientTempC = NAN;
float accelG = 0.0;

long irValue = 0;
bool fingerDetected = false;
float bpm = 0.0;
int bpmAverage = 0;
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
unsigned long lastBeat = 0;

bool freeFallSeen = false;
unsigned long freeFallAt = 0;
unsigned long fallAlertUntil = 0;

unsigned long lastTempRead = 0;
unsigned long lastMotionRead = 0;
unsigned long lastDisplay = 0;
unsigned long lastSerialLog = 0;
unsigned long lastIngestSend = 0;
bool wifiConnected = false;

bool fallAlertActive() {
  return fallAlertUntil != 0 && (long)(fallAlertUntil - millis()) > 0;
}

void scanI2C() {
  Serial.println();
  Serial.println("I2C scan:");
  byte count = 0;

  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("  Found device at 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      count++;
    }
  }

  if (count == 0) {
    Serial.println("  No I2C devices found. Check SDA/SCL and power wiring.");
  }
  Serial.println();
}

void drawBootScreen(const char *line1, const char *line2) {
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);
  display.setCursor(0, 12);
  display.print("SCEMS ESP32");
  display.setCursor(0, 30);
  display.print(line1);
  display.setCursor(0, 44);
  display.print(line2);
  display.sendBuffer();
}

void setupSensors() {
  drawBootScreen("Starting I2C...", "");
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  delay(100);

  scanI2C();

  drawBootScreen("OLED OK", "Starting sensors");

  mlxReady = mlx.begin(0x5A, &Wire);
  Serial.print("MLX90614 temp sensor: ");
  Serial.println(mlxReady ? "OK" : "NOT FOUND");

  mpuReady = mpu.begin(0x68, &Wire);
  Serial.print("MPU6050 fall sensor: ");
  Serial.println(mpuReady ? "OK" : "NOT FOUND");
  if (mpuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  heartReady = heartSensor.begin(Wire, I2C_SPEED_STANDARD);
  Serial.print("MAX30102 heart sensor: ");
  Serial.println(heartReady ? "OK" : "NOT FOUND");
  if (heartReady) {
    byte ledBrightness = 0x1F;
    byte sampleAverage = 4;
    byte ledMode = 2;       // Red + IR
    int sampleRate = 100;
    int pulseWidth = 411;
    int adcRange = 4096;

    heartSensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);
    heartSensor.setPulseAmplitudeRed(0x1F);
    heartSensor.setPulseAmplitudeIR(0x1F);
    heartSensor.setPulseAmplitudeGreen(0);
  }
}

void readGPS() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
}

void readTemperature() {
  if (!mlxReady) return;
  if (millis() - lastTempRead < 1000) return;
  lastTempRead = millis();

  ambientTempC = mlx.readAmbientTempC();
  bodyTempC = mlx.readObjectTempC() + BODY_TEMP_OFFSET_C;
}

void readHeart() {
  if (!heartReady) return;

  irValue = heartSensor.getIR();
  fingerDetected = irValue > 50000;

  if (!fingerDetected) {
    bpm = 0.0;
    bpmAverage = 0;
    return;
  }

  if (checkForBeat(irValue)) {
    unsigned long now = millis();
    unsigned long delta = now - lastBeat;
    lastBeat = now;

    if (delta > 0) {
      bpm = 60.0 / (delta / 1000.0);

      if (bpm > 35 && bpm < 220) {
        rates[rateSpot++] = (byte)bpm;
        rateSpot %= RATE_SIZE;

        int total = 0;
        int valid = 0;
        for (byte i = 0; i < RATE_SIZE; i++) {
          if (rates[i] > 0) {
            total += rates[i];
            valid++;
          }
        }
        bpmAverage = valid > 0 ? total / valid : 0;
      }
    }
  }
}

void triggerFallAlert() {
  fallAlertUntil = millis() + FALL_ALERT_MS;
  freeFallSeen = false;
}

void readMotion() {
  if (!mpuReady) return;
  if (millis() - lastMotionRead < 50) return;
  lastMotionRead = millis();

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  mpu.getEvent(&accel, &gyro, &temp);

  float ax = accel.acceleration.x;
  float ay = accel.acceleration.y;
  float az = accel.acceleration.z;
  accelG = sqrt((ax * ax) + (ay * ay) + (az * az)) / 9.80665;

  unsigned long now = millis();

  if (accelG < FREE_FALL_G) {
    freeFallSeen = true;
    freeFallAt = now;
  }

  if (freeFallSeen && (now - freeFallAt <= IMPACT_WINDOW_MS) && accelG > IMPACT_G) {
    triggerFallAlert();
  }

  if (freeFallSeen && (now - freeFallAt > IMPACT_WINDOW_MS)) {
    freeFallSeen = false;
  }

  if (accelG > HARD_IMPACT_G) {
    triggerFallAlert();
  }
}

void renderDisplay() {
  if (millis() - lastDisplay < 1000) return;
  lastDisplay = millis();

  display.clearBuffer();
  display.setFont(u8g2_font_5x8_tf);

  display.setCursor(0, 8);
  display.print("SCEMS MONITOR");

  display.setCursor(0, 17);
  display.print("Temp: ");
  if (mlxReady && !isnan(bodyTempC)) {
    display.print(bodyTempC, 1);
    display.print(" C");
    if (bodyTempC >= FEVER_TEMP_C) display.print(" HIGH");
  } else {
    display.print("--");
  }

  display.setCursor(0, 26);
  display.print("Heart: ");
  if (!heartReady) {
    display.print("not found");
  } else if (!fingerDetected) {
    display.print("place finger");
  } else if (bpmAverage > 0) {
    display.print(bpmAverage);
    display.print(" BPM");
  } else {
    display.print("reading...");
  }

  display.setCursor(0, 35);
  display.print("Fall: ");
  display.print(fallAlertActive() ? "ALERT" : "OK");
  if (mpuReady) {
    display.print(" ");
    display.print(accelG, 2);
    display.print("g");
  }

  display.setCursor(0, 44);
  display.print("GPS: ");
  if (gps.location.isValid()) {
    display.print("FIX ");
  } else {
    display.print("WAIT ");
  }
  display.print(gps.satellites.isValid() ? gps.satellites.value() : 0);
  display.print(" sat");

  display.setCursor(0, 53);
  display.print("Lat: ");
  if (gps.location.isValid()) {
    display.print(gps.location.lat(), 4);
  } else {
    display.print("--");
  }

  display.setCursor(0, 62);
  display.print("Lng: ");
  if (gps.location.isValid()) {
    display.print(gps.location.lng(), 4);
  } else {
    display.print("--");
  }

  display.sendBuffer();
}

void logSerial() {
  if (millis() - lastSerialLog < 2000) return;
  lastSerialLog = millis();

  Serial.println("----- SCEMS reading -----");

  Serial.print("Body temp C: ");
  if (mlxReady && !isnan(bodyTempC)) Serial.println(bodyTempC, 2);
  else Serial.println("not available");

  Serial.print("Ambient temp C: ");
  if (mlxReady && !isnan(ambientTempC)) Serial.println(ambientTempC, 2);
  else Serial.println("not available");

  Serial.print("Heart IR: ");
  Serial.print(irValue);
  Serial.print("  Finger: ");
  Serial.print(fingerDetected ? "yes" : "no");
  Serial.print("  BPM avg: ");
  Serial.println(bpmAverage);

  Serial.print("Acceleration: ");
  Serial.print(accelG, 2);
  Serial.print("g  Fall: ");
  Serial.println(fallAlertActive() ? "ALERT" : "OK");

  Serial.print("GPS: ");
  if (gps.location.isValid()) {
    Serial.print(gps.location.lat(), 6);
    Serial.print(", ");
    Serial.print(gps.location.lng(), 6);
  } else {
    Serial.print("no fix yet");
  }
  Serial.print("  Satellites: ");
  Serial.println(gps.satellites.isValid() ? gps.satellites.value() : 0);
  Serial.println();
}

void connectWiFi() {
  drawBootScreen("Connecting WiFi", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
    drawBootScreen("WiFi OK", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("WiFi connect failed - running offline (Serial/OLED only).");
    drawBootScreen("WiFi FAILED", "Running offline");
  }
  delay(600);
}

// Sends the fields we currently have valid readings for. Fields left out of
// the JSON body are left untouched on the backend (see server.js /api/ingest),
// so a missing GPS fix or unread finger sensor doesn't overwrite good data
// already stored for this patient.
void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    return;
  }
  wifiConnected = true;

  JsonDocument payload;
  payload["device_id"] = DEVICE_ID;

  if (heartReady && fingerDetected && bpmAverage > 0) {
    payload["heart_rate"] = bpmAverage;
  }
  if (mlxReady && !isnan(bodyTempC)) {
    payload["body_temp"] = bodyTempC;
  }
  if (mpuReady) {
    payload["fall_detect"] = fallAlertActive();
  }
  if (gps.location.isValid()) {
    payload["latitude"] = gps.location.lat();
    payload["longitude"] = gps.location.lng();
  }

  String body;
  serializeJson(payload, body);

  HTTPClient http;
  http.begin(INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(HTTP_TIMEOUT_MS);

  int statusCode = http.POST(body);
  if (statusCode > 0) {
    Serial.print("Ingest POST -> HTTP ");
    Serial.println(statusCode);
  } else {
    Serial.print("Ingest POST failed: ");
    Serial.println(http.errorToString(statusCode));
  }
  http.end();
}

void sendTelemetryIfDue() {
  if (millis() - lastIngestSend < INGEST_INTERVAL_MS) return;
  lastIngestSend = millis();
  sendTelemetry();
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);
  Serial.println();
  Serial.println("SCEMS WEMOS LOLIN32 LITE starting...");

  display.begin();
  drawBootScreen("Booting...", "Please wait");

  setupSensors();

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS serial started at 9600 baud.");

  connectWiFi();

  drawBootScreen("Ready", "Open Serial Monitor");
}

void loop() {
  readGPS();
  readTemperature();
  readHeart();
  readMotion();
  renderDisplay();
  logSerial();
  sendTelemetryIfDue();
}
