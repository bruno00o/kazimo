import { normalizePairingCode, tokens } from "@kazimo/shared";
import {
  type BarcodeScanningResult,
  type BarcodeSettings,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { linkFrame } from "../src/frame";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { isPairingCode, type PairingStage, parsePairingQr, runPairing } from "../src/pairing";
import { defaultServerFrom, normalizeMatrixId } from "../src/rooms";
import { useSession } from "../src/session-context";

const t = appStrings();

const WHITE = "#ffffff";
const BACK_ICON_SIZE = 26;
const VIEWFINDER_ICON_SIZE = 64;
const DONE_ICON_SIZE = 72;
const QR_BARCODE_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };

type Mode = "scan" | "manual";

type Phase = { kind: "form" } | { kind: "pairing"; stage: PairingStage } | { kind: "done" };

const FORM: Phase = { kind: "form" };

export default function PairFrame() {
  const { client, homeserver } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("scan");
  const [phase, setPhase] = useState<Phase>(FORM);
  const [failed, setFailed] = useState(false);
  const [frameId, setFrameId] = useState("");
  const [code, setCode] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const asked = useRef(false);
  const scanned = useRef<string | null>(null);
  const alive = useRef(true);

  const defaultServer = useMemo(() => defaultServerFrom(homeserver) ?? "", [homeserver]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "scan" || asked.current) return;
    asked.current = true;
    void requestPermission();
  }, [mode, requestPermission]);

  const start = useCallback(
    (frameUserId: string, pairingCode: string) => {
      setFailed(false);
      setPhase({ kind: "pairing", stage: "opening" });
      void runPairing(client, frameUserId, pairingCode, (stage) => {
        if (alive.current) setPhase({ kind: "pairing", stage });
      }).then((outcome) => {
        if (outcome.ok) void linkFrame(client, { frameUserId, controlRoomId: outcome.controlRoomId });
        if (!alive.current) return;
        scanned.current = null;
        setPhase(outcome.ok ? { kind: "done" } : FORM);
        setFailed(!outcome.ok);
      });
    },
    [client],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (phase.kind !== "form" || scanned.current === result.data) return;
      const target = parsePairingQr(result.data);
      if (!target) return;
      scanned.current = result.data;
      start(target.userId, target.code);
    },
    [phase.kind, start],
  );

  const submitManual = useCallback(() => {
    const frameUserId = normalizeMatrixId(frameId, defaultServer);
    const pairingCode = normalizePairingCode(code);
    if (!frameUserId || !isPairingCode(pairingCode)) {
      setFailed(true);
      return;
    }
    start(frameUserId, pairingCode);
  }, [code, defaultServer, frameId, start]);

  if (phase.kind === "pairing") {
    const announced = phase.stage === "waiting" || phase.stage === "joining";
    return (
      <View style={styles.full}>
        <ActivityIndicator size="large" color={tokens.color.blue} />
        {announced && <Text style={styles.fullTitle}>{t.pairWaiting}</Text>}
      </View>
    );
  }

  if (phase.kind === "done") {
    return (
      <View style={[styles.full, { paddingBottom: insets.bottom + 16 }]}>
        <Icon name="frame" color={tokens.color.blue} size={DONE_ICON_SIZE} />
        <Text style={styles.fullTitle}>{t.pairDone}</Text>
        <Text style={styles.fullBody}>{t.pairDoneBody}</Text>
        <Pressable
          style={[styles.button, styles.buttonWide]}
          accessibilityRole="button"
          onPress={() => router.replace("/frame")}
        >
          <Text style={styles.buttonText}>{t.ok}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { paddingBottom: insets.bottom + 16 }]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.cancel}
          style={styles.back}
          onPress={() => router.back()}
        >
          <Icon name="back" color={tokens.color.blue} size={BACK_ICON_SIZE} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {t.pairTitle}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={styles.segmented}>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, mode === "scan" && styles.pillActive]}
            onPress={() => setMode("scan")}
          >
            <Text style={[styles.pillText, mode === "scan" && styles.pillTextActive]}>{t.pairScan}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, mode === "manual" && styles.pillActive]}
            onPress={() => setMode("manual")}
          >
            <Text style={[styles.pillText, mode === "manual" && styles.pillTextActive]}>{t.pairManual}</Text>
          </Pressable>
        </View>

        <Text style={styles.body}>{t.pairBody}</Text>

        {mode === "scan" ? (
          <View style={styles.viewfinder}>
            <Icon name="qr" color={tokens.color.blueSoft} size={VIEWFINDER_ICON_SIZE} />
            {permission?.granted && (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={QR_BARCODE_SETTINGS}
                onBarcodeScanned={onBarcodeScanned}
              />
            )}
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.label}>{t.pairFrameId}</Text>
            <TextInput
              style={styles.input}
              value={frameId}
              onChangeText={setFrameId}
              placeholder={t.pairFrameIdPlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
            />
            <Text style={styles.label}>{t.pairCode}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder={t.pairCodePlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submitManual}
            />
            <Pressable style={styles.button} accessibilityRole="button" onPress={submitManual}>
              <Text style={styles.buttonText}>{t.pairAction}</Text>
            </Pressable>
          </View>
        )}

        {failed && <Text style={styles.failure}>{t.pairFailed}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.theme.light.ground,
  },
  full: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 32,
    backgroundColor: tokens.theme.light.ground,
  },
  fullTitle: {
    fontSize: 24,
    fontWeight: "600",
    textAlign: "center",
    color: tokens.theme.light.ink,
  },
  fullBody: {
    fontSize: 17,
    textAlign: "center",
    color: tokens.theme.light.inkSoft,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.theme.light.inkFaint,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: tokens.theme.light.ink,
  },
  form: {
    gap: 16,
    padding: 20,
  },
  segmented: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blueSoft,
  },
  pillActive: {
    backgroundColor: tokens.color.blue,
  },
  pillText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
  pillTextActive: {
    color: WHITE,
  },
  body: {
    fontSize: 15,
    color: tokens.theme.light.inkSoft,
  },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: tokens.theme.dark.ground,
  },
  field: {
    gap: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.theme.light.inkSoft,
  },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 18,
    color: tokens.theme.light.ink,
    backgroundColor: tokens.color.blueSoft,
  },
  buttonWide: {
    paddingHorizontal: 56,
  },
  button: {
    marginTop: 8,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blue,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
    color: WHITE,
  },
  failure: {
    fontSize: 14,
    textAlign: "center",
    color: tokens.color.danger,
  },
});
