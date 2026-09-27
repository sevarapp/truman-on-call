# CPR force sensor (optional hardware)

A $10 add-on that turns any pillow into a CPR trainer.

**Parts:** Arduino Uno or Nano (or ESP32), FSR 402 force-sensitive resistor, 10 kΩ resistor, jumper wires, a hardcover book.

**Build:**
1. Wire the FSR and resistor as a voltage divider into A0 (see the comment at the top of `cpr_sensor/cpr_sensor.ino`).
2. Flash `cpr_sensor.ino` with the Arduino IDE.
3. Put the FSR under the center of a firm pillow, with the book on top of the pillow so your hands press evenly.
4. In the game, open **CPR Lab** (or the CPR step in the Library level), choose **🔌 USB sensor**, and pick the board's port.

The game only needs one number per line over serial at 115200 baud, so any sensor works: a load cell with an HX711, an accelerometer, or a distance sensor. With a time-of-flight distance sensor (VL53L0X) above the pillow you could measure true compression depth in centimeters.

**No hardware?** The same CPR Lab works with your phone's accelerometer (hold it between your hands) or a webcam watching from the side.
