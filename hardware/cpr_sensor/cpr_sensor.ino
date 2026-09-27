// Maya on Call — CPR force sensor (for the "USB sensor" option in the game)
//
// Parts: Arduino Uno/Nano (or ESP32), FSR 402 force-sensitive resistor, 10k resistor.
// Wiring (voltage divider):
//   5V ── FSR ──┬── A0
//               └── 10k ── GND
//   (ESP32: use 3.3V and an ADC pin like 34, and change SENSOR_PIN.)
// Put the FSR under the center of a firm pillow (a book on top spreads the force).
// The game reads one number per line at 115200 baud via Web Serial (Chrome/Edge).

const int SENSOR_PIN = A0;
const unsigned long PERIOD_MS = 10;   // 100 samples per second
float smooth = 0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last < PERIOD_MS) return;
  last = millis();
  int raw = analogRead(SENSOR_PIN);
  smooth = smooth * 0.6 + raw * 0.4;  // light smoothing, the game does the rest
  Serial.println((int)smooth);
}
