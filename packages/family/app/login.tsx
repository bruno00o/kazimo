import { tokens } from "@kazimo/shared";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignInCancelledError, type StoredSession, signIn } from "../src/auth";
import { readHomeserver } from "../src/env";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { Failure, Field, PrimaryButton } from "../src/ui";

WebBrowser.maybeCompleteAuthSession();

const t = appStrings();

const BADGE_SIZE = 112;
const BADGE_ICON_SIZE = 56;

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Icon name="frame" color={tokens.color.blueDeep} size={BADGE_ICON_SIZE} />
        </View>
        <Text style={styles.title}>{t.welcome}</Text>
        <Text style={styles.body}>{t.welcomeBody}</Text>
      </View>
      <View style={styles.form}>
        <Field
          label={t.homeserver}
          value={homeserver}
          onChangeText={setHomeserver}
          placeholder={t.homeserverPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          editable={!pending}
          onSubmitEditing={() => void submit()}
        />
        <PrimaryButton
          label={pending ? t.signingIn : t.signIn}
          pending={pending}
          disabled={homeserver.trim().length === 0}
          onPress={() => void submit()}
        />
        <Failure text={failure} />
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
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 16,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    backgroundColor: tokens.color.blueSoft,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    textAlign: "center",
    color: tokens.color.blueDeep,
  },
  body: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center",
    color: tokens.theme.light.inkSoft,
  },
  form: {
    gap: 10,
  },
});
