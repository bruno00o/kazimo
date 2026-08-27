#include <ArduinoJson.h>
#include <M5Dial.h>

static constexpr int PIN_BUTTON_GREEN = 1;
static constexpr int PIN_BUTTON_MAGENTA = 2;

static constexpr int PIN_POWER_HOLD = 46;

static const char *FIRMWARE_VERSION = "1.0.0";

static constexpr int WHEEL_DIRECTION = 1;
static constexpr long WHEEL_COUNTS_PER_DETENT = 4;
static constexpr uint32_t BUTTON_DEBOUNCE_MS = 30;
static constexpr uint32_t MAINTENANCE_HOLD_MS = 5000;
static constexpr uint32_t LOOP_INTERVAL_MS = 2;
static constexpr uint32_t SERIAL_TX_TIMEOUT_MS = 0;
static constexpr uint32_t SERIAL_BAUDRATE = 115200;

static constexpr size_t LABEL_CAPACITY = 25;
static constexpr size_t INBOUND_CAPACITY = 512;
static constexpr size_t OUTBOUND_CAPACITY = 96;

static constexpr int SCREEN_SIZE = 240;
static constexpr int SCREEN_CENTER = 120;
static constexpr uint8_t SCREEN_BRIGHTNESS = 160;
static constexpr int ROW_GREEN_Y = 82;
static constexpr int ROW_MAGENTA_Y = 158;
static constexpr int DOT_RADIUS = 11;
static constexpr int DOT_TEXT_GAP = 14;
static constexpr int ROW_MAX_WIDTH = 190;

static constexpr uint32_t COLOR_BACKGROUND = 0x000000;
static constexpr uint32_t COLOR_LABEL = 0xF2EFE9;
static constexpr uint32_t COLOR_GREEN = 0x2FBF57;
static constexpr uint32_t COLOR_MAGENTA = 0xD62E86;

static const lgfx::IFont *const LABEL_FONTS[] = {
    &fonts::FreeSansBold24pt7b,
    &fonts::FreeSansBold18pt7b,
    &fonts::FreeSansBold12pt7b,
    &fonts::FreeSansBold9pt7b,
};
static constexpr size_t LABEL_FONT_COUNT = sizeof(LABEL_FONTS) / sizeof(LABEL_FONTS[0]);

struct LatinFold {
  uint16_t code;
  char plain;
};

static constexpr LatinFold LATIN_FOLDS[] = {
    {0xC0, 'A'}, {0xC1, 'A'}, {0xC2, 'A'}, {0xC3, 'A'}, {0xC4, 'A'}, {0xC7, 'C'}, {0xC8, 'E'},
    {0xC9, 'E'}, {0xCA, 'E'}, {0xCB, 'E'}, {0xCC, 'I'}, {0xCD, 'I'}, {0xCE, 'I'}, {0xCF, 'I'},
    {0xD1, 'N'}, {0xD2, 'O'}, {0xD3, 'O'}, {0xD4, 'O'}, {0xD5, 'O'}, {0xD6, 'O'}, {0xD9, 'U'},
    {0xDA, 'U'}, {0xDB, 'U'}, {0xDC, 'U'}, {0xE0, 'a'}, {0xE1, 'a'}, {0xE2, 'a'}, {0xE3, 'a'},
    {0xE4, 'a'}, {0xE7, 'c'}, {0xE8, 'e'}, {0xE9, 'e'}, {0xEA, 'e'}, {0xEB, 'e'}, {0xEC, 'i'},
    {0xED, 'i'}, {0xEE, 'i'}, {0xEF, 'i'}, {0xF1, 'n'}, {0xF2, 'o'}, {0xF3, 'o'}, {0xF4, 'o'},
    {0xF5, 'o'}, {0xF6, 'o'}, {0xF9, 'u'}, {0xFA, 'u'}, {0xFB, 'u'}, {0xFC, 'u'},
};
static constexpr size_t LATIN_FOLD_COUNT = sizeof(LATIN_FOLDS) / sizeof(LATIN_FOLDS[0]);

struct DebouncedButton {
  int pin;
  const char *name;
  bool pressed;
  bool candidate;
  uint32_t candidateSince;
};

static M5Canvas canvas(&M5Dial.Display);

static DebouncedButton greenButton = {PIN_BUTTON_GREEN, "green", false, false, 0};
static DebouncedButton magentaButton = {PIN_BUTTON_MAGENTA, "magenta", false, false, 0};

static char greenLabel[LABEL_CAPACITY] = "";
static char magentaLabel[LABEL_CAPACITY] = "";
static bool needsRedraw = false;

static long lastEncoderPosition = 0;
static long wheelAccumulator = 0;

static bool maintenanceFired = false;
static bool hostAttached = false;

static char inboundLine[INBOUND_CAPACITY];
static size_t inboundLength = 0;
static bool inboundOverflow = false;

static void sendLine(const char *line) { Serial.println(line); }

static void sendHello() {
  char line[OUTBOUND_CAPACITY];
  snprintf(line, sizeof(line), "{\"t\":\"hello\",\"fw\":\"%s\"}", FIRMWARE_VERSION);
  sendLine(line);
}

static void sendWheel(int direction) {
  char line[OUTBOUND_CAPACITY];
  snprintf(line, sizeof(line), "{\"t\":\"wheel\",\"d\":%d}", direction);
  sendLine(line);
}

static void sendButton(const char *name, const char *kind) {
  char line[OUTBOUND_CAPACITY];
  snprintf(line, sizeof(line), "{\"t\":\"button\",\"b\":\"%s\",\"k\":\"%s\"}", name, kind);
  sendLine(line);
}

static void sendMaintenance() { sendLine("{\"t\":\"maintenance\"}"); }

static void sendPong() { sendLine("{\"t\":\"pong\"}"); }

static char foldedLatin(uint16_t code) {
  for (size_t i = 0; i < LATIN_FOLD_COUNT; i++) {
    if (LATIN_FOLDS[i].code == code) return LATIN_FOLDS[i].plain;
  }
  return '\0';
}

static void copyAsLabel(char *destination, size_t capacity, const char *source) {
  size_t written = 0;
  for (size_t i = 0; source[i] != '\0' && written + 1 < capacity;) {
    const uint8_t lead = (uint8_t)source[i];
    if (lead < 0x80) {
      destination[written++] = (char)lead;
      i++;
      continue;
    }
    if ((lead & 0xE0) == 0xC0 && (source[i + 1] & 0xC0) == 0x80) {
      const uint16_t code = (uint16_t)(((lead & 0x1F) << 6) | (source[i + 1] & 0x3F));
      const char plain = foldedLatin(code);
      if (plain != '\0') destination[written++] = plain;
      i += 2;
      continue;
    }
    if ((lead & 0xF0) == 0xE0) {
      i += 3;
      continue;
    }
    if ((lead & 0xF8) == 0xF0) {
      i += 4;
      continue;
    }
    i++;
  }
  destination[written] = '\0';
}

static const lgfx::IFont *fittingFont(const char *text, int budget) {
  for (size_t i = 0; i < LABEL_FONT_COUNT; i++) {
    canvas.setFont(LABEL_FONTS[i]);
    if (canvas.textWidth(text) <= budget) return LABEL_FONTS[i];
  }
  return LABEL_FONTS[LABEL_FONT_COUNT - 1];
}

static void drawRow(int y, uint32_t dotColor, const char *text) {
  if (text[0] == '\0') return;
  const int budget = ROW_MAX_WIDTH - DOT_RADIUS * 2 - DOT_TEXT_GAP;
  canvas.setFont(fittingFont(text, budget));
  const int textWidth = canvas.textWidth(text);
  const int groupWidth = DOT_RADIUS * 2 + DOT_TEXT_GAP + textWidth;
  const int left = SCREEN_CENTER - groupWidth / 2;
  canvas.fillCircle(left + DOT_RADIUS, y, DOT_RADIUS, dotColor);
  canvas.setTextDatum(middle_left);
  canvas.setTextColor(COLOR_LABEL, COLOR_BACKGROUND);
  canvas.drawString(text, left + DOT_RADIUS * 2 + DOT_TEXT_GAP, y);
}

static void render() {
  canvas.fillScreen(COLOR_BACKGROUND);
  drawRow(ROW_GREEN_Y, COLOR_GREEN, greenLabel);
  drawRow(ROW_MAGENTA_Y, COLOR_MAGENTA, magentaLabel);
  canvas.pushSprite(0, 0);
}

static void handleLine(const char *line) {
  JsonDocument document;
  if (deserializeJson(document, line) != DeserializationError::Ok) return;
  const char *type = document["t"];
  if (type == nullptr) return;
  if (strcmp(type, "ping") == 0) {
    sendPong();
    return;
  }
  if (strcmp(type, "labels") == 0) {
    copyAsLabel(greenLabel, sizeof(greenLabel), document["green"] | "");
    copyAsLabel(magentaLabel, sizeof(magentaLabel), document["magenta"] | "");
    needsRedraw = true;
  }
}

static void readSerial() {
  while (Serial.available() > 0) {
    const int byte = Serial.read();
    if (byte < 0) return;
    if (byte == '\n') {
      inboundLine[inboundLength] = '\0';
      if (!inboundOverflow) handleLine(inboundLine);
      inboundLength = 0;
      inboundOverflow = false;
      continue;
    }
    if (byte == '\r') continue;
    if (inboundLength + 1 >= INBOUND_CAPACITY) {
      inboundOverflow = true;
      continue;
    }
    inboundLine[inboundLength++] = (char)byte;
  }
}

static void updateButton(DebouncedButton &button, uint32_t now) {
  const bool raw = digitalRead(button.pin) == LOW;
  if (raw != button.candidate) {
    button.candidate = raw;
    button.candidateSince = now;
    return;
  }
  if (raw == button.pressed) return;
  if (now - button.candidateSince < BUTTON_DEBOUNCE_MS) return;
  button.pressed = raw;
  sendButton(button.name, raw ? "press" : "release");
}

static void updateWheel() {
  const long position = M5Dial.Encoder.read();
  const long delta = position - lastEncoderPosition;
  if (delta == 0) return;
  lastEncoderPosition = position;
  wheelAccumulator += delta;
  while (wheelAccumulator >= WHEEL_COUNTS_PER_DETENT) {
    sendWheel(WHEEL_DIRECTION);
    wheelAccumulator -= WHEEL_COUNTS_PER_DETENT;
  }
  while (wheelAccumulator <= -WHEEL_COUNTS_PER_DETENT) {
    sendWheel(-WHEEL_DIRECTION);
    wheelAccumulator += WHEEL_COUNTS_PER_DETENT;
  }
}

static void updateMaintenance() {
  if (M5Dial.BtnA.wasPressed()) maintenanceFired = false;
  if (maintenanceFired) return;
  if (!M5Dial.BtnA.pressedFor(MAINTENANCE_HOLD_MS)) return;
  maintenanceFired = true;
  sendMaintenance();
}

static void updateHostLink() {
  const bool attached = (bool)Serial;
  if (attached == hostAttached) return;
  hostAttached = attached;
  if (attached) sendHello();
}

void setup() {
  pinMode(PIN_POWER_HOLD, OUTPUT);
  digitalWrite(PIN_POWER_HOLD, HIGH);

  auto configuration = M5.config();
  M5Dial.begin(configuration, true, false);
  Serial.begin(SERIAL_BAUDRATE);
  Serial.setTxTimeoutMs(SERIAL_TX_TIMEOUT_MS);

  pinMode(PIN_BUTTON_GREEN, INPUT_PULLUP);
  pinMode(PIN_BUTTON_MAGENTA, INPUT_PULLUP);

  M5Dial.Display.setBrightness(SCREEN_BRIGHTNESS);
  canvas.setColorDepth(16);
  canvas.createSprite(SCREEN_SIZE, SCREEN_SIZE);

  lastEncoderPosition = M5Dial.Encoder.read();
  const uint32_t now = millis();
  greenButton.candidateSince = now;
  magentaButton.candidateSince = now;

  render();
  sendHello();
}

void loop() {
  M5Dial.update();
  const uint32_t now = millis();

  updateHostLink();
  readSerial();
  updateWheel();
  updateButton(greenButton, now);
  updateButton(magentaButton, now);
  updateMaintenance();

  if (needsRedraw) {
    needsRedraw = false;
    render();
  }

  delay(LOOP_INTERVAL_MS);
}
