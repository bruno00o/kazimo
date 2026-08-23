import { tokens } from "@kazimo/shared";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { recoveryKeyRows, type SecurityPrompt, submitRecoveryKey } from "./e2ee";
import { appStrings } from "./i18n";

const t = appStrings();

const WHITE = "#ffffff";

type SecurityGateProps = {
  client: ClientLike;
  prompt: SecurityPrompt;
  onDone: (completed: boolean) => void;
};

export function SecurityGate({ client, prompt, onDone }: SecurityGateProps) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 };
  return prompt.state === "showKey" ? (
    <ShowKey recoveryKey={prompt.recoveryKey} padding={padding} onDone={onDone} />
  ) : (
    <EnterKey client={client} padding={padding} onDone={onDone} />
  );
}

type Padding = { paddingTop: number; paddingBottom: number };

function ShowKey({
  recoveryKey,
  padding,
  onDone,
}: {
  recoveryKey: string;
  padding: Padding;
  onDone: (completed: boolean) => void;
}) {
  return (
    <View style={[styles.screen, padding]}>
      <View style={styles.hero}>
        <Text style={styles.title}>{t.securityTitle}</Text>
        <Text style={styles.body}>{t.securityBody}</Text>
      </View>
      <View style={styles.form}>
        <View style={styles.keyCard}>
          {recoveryKeyRows(recoveryKey).map((row) => (
            <Text key={row} style={styles.keyRow} selectable>
              {row}
            </Text>
          ))}
        </View>
        <Text style={styles.hint}>{t.securityKeyHint}</Text>
        <Pressable style={styles.button} onPress={() => onDone(true)} accessibilityRole="button">
          <Text style={styles.buttonText}>{t.securityContinue}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EnterKey({
  client,
  padding,
  onDone,
}: {
  client: ClientLike;
  padding: Padding;
  onDone: (completed: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = useCallback(async () => {
    if (pending || !key.trim()) return;
    setPending(true);
    setFailed(false);
    const unlocked = await submitRecoveryKey(client, key);
    if (unlocked) {
      onDone(true);
      return;
    }
    setFailed(true);
    setPending(false);
  }, [client, key, onDone, pending]);

  const disabled = pending || key.trim().length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, padding]}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>{t.securityEnterTitle}</Text>
        <Text style={styles.body}>{t.securityEnterBody}</Text>
      </View>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={key}
          onChangeText={setKey}
          placeholder={t.securityEnterPlaceholder}
          placeholderTextColor={tokens.theme.light.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="go"
          editable={!pending}
          onSubmitEditing={() => void submit()}
        />
        <Pressable
          style={[styles.button, disabled && styles.buttonDisabled]}
          disabled={disabled}
          onPress={() => void submit()}
          accessibilityRole="button"
        >
          {pending && <ActivityIndicator color={WHITE} />}
          <Text style={styles.buttonText}>{t.securityEnterAction}</Text>
        </Pressable>
        {failed && <Text style={styles.failure}>{t.securityEnterFailed}</Text>}
        <Pressable style={styles.later} onPress={() => onDone(false)} accessibilityRole="button">
          <Text style={styles.laterText}>{t.securityLater}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    backgroundColor: tokens.theme.light.ground,
  },
  hero: {
    gap: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: tokens.color.blueDeep,
  },
  body: {
    fontSize: 18,
    lineHeight: 26,
    color: tokens.theme.light.inkSoft,
  },
  form: {
    gap: 10,
  },
  keyCard: {
    gap: 6,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: tokens.color.blueSoft,
  },
  keyRow: {
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: 2,
    textAlign: "center",
    color: tokens.color.blueDeep,
  },
  hint: {
    fontSize: 14,
    textAlign: "center",
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
  button: {
    marginTop: 8,
    height: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: tokens.color.blue,
  },
  buttonDisabled: {
    opacity: 0.6,
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
  later: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  laterText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.blue,
  },
});
