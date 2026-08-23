import { tokens } from "@kazimo/shared";
import * as WebBrowser from "expo-web-browser";
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
import { SignInCancelledError, type StoredSession, signIn } from "../src/auth";
import { readHomeserver } from "../src/env";
import { appStrings } from "../src/i18n";

WebBrowser.maybeCompleteAuthSession();

const t = appStrings();

const WHITE = "#ffffff";

type LoginProps = {
  onSignedIn?: (session: StoredSession) => void;
};

export default function Login({ onSignedIn }: LoginProps) {
  const insets = useSafeAreaInsets();
  const [homeserver, setHomeserver] = useState(readHomeserver() ?? "");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const session = await signIn(homeserver);
      onSignedIn?.(session);
    } catch (error) {
      if (!(error instanceof SignInCancelledError)) {
        setFailure(error instanceof Error && error.message ? error.message : t.signInFailed);
      }
    } finally {
      setPending(false);
    }
  }, [homeserver, onSignedIn, pending]);

  const disabled = pending || homeserver.trim().length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>{t.welcome}</Text>
        <Text style={styles.body}>{t.welcomeBody}</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>{t.homeserver}</Text>
        <TextInput
          style={styles.input}
          value={homeserver}
          onChangeText={setHomeserver}
          placeholder={t.homeserverPlaceholder}
          placeholderTextColor={tokens.theme.light.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
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
          <Text style={styles.buttonText}>{pending ? t.signingIn : t.signIn}</Text>
        </Pressable>
        {failure && <Text style={styles.failure}>{failure}</Text>}
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
});
