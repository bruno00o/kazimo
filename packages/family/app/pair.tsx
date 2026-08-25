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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { linkFrame } from "../src/frame";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { isPairingCode, type PairingStage, parsePairingQr, runPairing } from "../src/pairing";
import { defaultServerFrom, normalizeMatrixId } from "../src/rooms";
import { useSession } from "../src/session-context";
import { Failure, Field, PrimaryButton, ScreenHeader, Segmented } from "../src/ui";

const t = appStrings();

const VIEWFINDER_ICON_SIZE = 64;
const DONE_ICON_SIZE = 72;
const QR_BARCODE_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };

type Mode = "scan" | "manual";

type Phase = { kind: "form" } | { kind: "pairing"; stage: PairingStage } | { kind: "done" };

const FORM: Phase = { kind: "form" };

const MODE_OPTIONS = [
  { key: "scan", label: t.pairScan },
  { key: "manual", label: t.pairManual },
] as const;

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
        <View style={styles.doneBadge}>
          <Icon name="frame" color={tokens.color.blueDeep} size={DONE_ICON_SIZE} />
        </View>
        <Text style={styles.fullTitle}>{t.pairDone}</Text>
        <Text style={styles.fullBody}>{t.pairDoneBody}</Text>
        <View style={styles.doneAction}>
          <PrimaryButton label={t.ok} onPress={() => router.replace("/frame")} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { paddingBottom: insets.bottom + 16 }]}
    >
      <View style={{ paddingTop: insets.top + 14 }}>
        <ScreenHeader title={t.pairTitle} backLabel={t.cancel} onBack={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} />

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
          <View style={styles.fields}>
            <Field
              label={t.pairFrameId}
              value={frameId}
              onChangeText={setFrameId}
              placeholder={t.pairFrameIdPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
            />
            <Field
              label={t.pairCode}
              value={code}
              onChangeText={setCode}
              placeholder={t.pairCodePlaceholder}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submitManual}
            />
            <PrimaryButton label={t.pairAction} onPress={submitManual} />
          </View>
        )}

        <Failure text={failed ? t.pairFailed : null} />
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
  doneBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    backgroundColor: tokens.color.blueSoft,
  },
  doneAction: {
    alignSelf: "stretch",
    paddingHorizontal: 32,
  },
  form: {
    gap: 16,
    padding: 20,
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
  fields: {
    gap: 10,
  },
});
