import { type FrameContact, tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import {
  type FrameLink,
  frameContacts,
  frameLink,
  profileName,
  promoteAdmin,
  removeFrameContact,
  setFrameContact,
} from "../src/frame";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { defaultServerFrom, normalizeMatrixId } from "../src/rooms";
import { useSession } from "../src/session-context";

const t = appStrings();

const WHITE = "#ffffff";
const BACK_ICON_SIZE = 26;
const FRAME_ICON_SIZE = 34;
const ROW_ICON_SIZE = 20;

type Tab = "contacts" | "admins";

type Phase = { kind: "loading" } | { kind: "ready"; link: FrameLink };

const LOADING: Phase = { kind: "loading" };

export default function FrameAdmin() {
  const { client, homeserver } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>(LOADING);
  const [tab, setTab] = useState<Tab>("contacts");
  const [contacts, setContacts] = useState<FrameContact[]>([]);
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [adminId, setAdminId] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const defaultServer = useMemo(() => defaultServerFrom(homeserver) ?? "", [homeserver]);

  const reload = useCallback(
    async (controlRoomId: string) => {
      const list = await frameContacts(client, controlRoomId).catch(() => null);
      if (list === null) {
        setFailure(t.frameLoadFailed);
        return;
      }
      setContacts(list);
    },
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    void frameLink(client)
      .catch(() => null)
      .then(async (found) => {
        if (cancelled) return;
        if (!found) {
          router.replace("/pair");
          return;
        }
        setPhase({ kind: "ready", link: found });
        await reload(found.controlRoomId);
      });
    return () => {
      cancelled = true;
    };
  }, [client, reload, router]);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    setFailure(null);
  }, []);

  const fillName = useCallback(() => {
    const userId = normalizeMatrixId(contactId, defaultServer);
    if (!userId || contactName.trim().length > 0) return;
    void profileName(client, userId).then((name) => {
      if (name) setContactName(name);
    });
  }, [client, contactId, contactName, defaultServer]);

  const addContact = useCallback(async () => {
    if (pending || phase.kind !== "ready") return;
    setFailure(null);
    const userId = normalizeMatrixId(contactId, defaultServer);
    const name = contactName.trim();
    if (!userId || name.length === 0) {
      setFailure(t.frameAddFailed);
      return;
    }
    setPending(true);
    try {
      await setFrameContact(client, phase.link.controlRoomId, userId, name);
      setContactId("");
      setContactName("");
      await reload(phase.link.controlRoomId);
    } catch {
      setFailure(t.frameAddFailed);
    } finally {
      setPending(false);
    }
  }, [client, contactId, contactName, defaultServer, pending, phase, reload]);

  const confirmRemove = useCallback(
    (contact: FrameContact) => {
      if (phase.kind !== "ready") return;
      const controlRoomId = phase.link.controlRoomId;
      Alert.alert(t.frameRemoveContact, t.frameRemoveConfirmBody, [
        { text: t.cancel, style: "cancel" },
        {
          text: t.frameRemove,
          style: "destructive",
          onPress: () => {
            setFailure(null);
            void removeFrameContact(client, controlRoomId, contact.userId)
              .then(() => reload(controlRoomId))
              .catch(() => setFailure(t.frameRemoveFailed));
          },
        },
      ]);
    },
    [client, phase, reload],
  );

  const confirmPromote = useCallback(() => {
    if (pending || phase.kind !== "ready") return;
    setFailure(null);
    const userId = normalizeMatrixId(adminId, defaultServer);
    if (!userId) {
      setFailure(t.framePromoteFailed);
      return;
    }
    const controlRoomId = phase.link.controlRoomId;
    Alert.alert(t.framePromote, t.framePromoteConfirmBody, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.framePromote,
        onPress: () => {
          setPending(true);
          void promoteAdmin(client, controlRoomId, userId)
            .then(() => setAdminId(""))
            .catch(() => setFailure(t.framePromoteFailed))
            .finally(() => setPending(false));
        },
      },
    ]);
  }, [adminId, client, defaultServer, pending, phase]);

  if (phase.kind === "loading") {
    return (
      <View style={styles.full}>
        <ActivityIndicator size="large" color={tokens.color.blue} />
        <Text style={styles.fullTitle}>{t.frameLoading}</Text>
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
          {t.frameTitle}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Icon name="frame" color={tokens.color.blue} size={FRAME_ICON_SIZE} />
          <View style={styles.identityBody}>
            <Text style={styles.identityLabel}>{t.frameLinkedTo}</Text>
            <Text style={styles.identityId} numberOfLines={1}>
              {phase.link.frameUserId}
            </Text>
          </View>
        </View>

        <View style={styles.segmented}>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, tab === "contacts" && styles.pillActive]}
            onPress={() => selectTab("contacts")}
          >
            <Text style={[styles.pillText, tab === "contacts" && styles.pillTextActive]}>
              {t.frameContacts}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, tab === "admins" && styles.pillActive]}
            onPress={() => selectTab("admins")}
          >
            <Text style={[styles.pillText, tab === "admins" && styles.pillTextActive]}>{t.frameAdmins}</Text>
          </Pressable>
        </View>

        {tab === "contacts" ? (
          <View style={styles.field}>
            <Text style={styles.body}>{t.frameContactsBody}</Text>
            {contacts.length === 0 ? (
              <Text style={styles.empty}>{t.frameNoContacts}</Text>
            ) : (
              contacts.map((contact) => (
                <View key={contact.userId} style={styles.contact}>
                  <View style={styles.contactBody}>
                    <Text style={styles.contactName} numberOfLines={1}>
                      {contact.name}
                    </Text>
                    <Text style={styles.contactId} numberOfLines={1}>
                      {contact.userId}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.frameRemoveContact}
                    style={styles.contactAction}
                    disabled={pending}
                    onPress={() => confirmRemove(contact)}
                  >
                    <Icon name="remove" color={tokens.color.danger} size={ROW_ICON_SIZE} />
                  </Pressable>
                </View>
              ))
            )}

            <Text style={styles.label}>{t.matrixId}</Text>
            <TextInput
              style={styles.input}
              value={contactId}
              onChangeText={setContactId}
              placeholder={t.matrixIdPlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              editable={!pending}
              onBlur={fillName}
              onEndEditing={fillName}
            />
            <Text style={styles.label}>{t.frameName}</Text>
            <TextInput
              style={styles.input}
              value={contactName}
              onChangeText={setContactName}
              placeholder={t.frameNamePlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCorrect={false}
              returnKeyType="done"
              editable={!pending}
              onSubmitEditing={() => void addContact()}
            />
            <Pressable
              style={[styles.button, pending && styles.buttonDisabled]}
              accessibilityRole="button"
              disabled={pending}
              onPress={() => void addContact()}
            >
              {pending && <ActivityIndicator color={WHITE} />}
              <Icon name="add" color={WHITE} size={ROW_ICON_SIZE} />
              <Text style={styles.buttonText}>{t.frameAddContact}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.body}>{t.frameAdminsBody}</Text>
            <Text style={styles.label}>{t.matrixId}</Text>
            <TextInput
              style={styles.input}
              value={adminId}
              onChangeText={setAdminId}
              placeholder={t.matrixIdPlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              editable={!pending}
              onSubmitEditing={confirmPromote}
            />
            <Pressable
              style={[styles.button, pending && styles.buttonDisabled]}
              accessibilityRole="button"
              disabled={pending}
              onPress={confirmPromote}
            >
              {pending && <ActivityIndicator color={WHITE} />}
              <Icon name="admin" color={WHITE} size={ROW_ICON_SIZE} />
              <Text style={styles.buttonText}>{t.framePromote}</Text>
            </Pressable>
          </View>
        )}

        {failure !== null && <Text style={styles.failure}>{failure}</Text>}
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
    fontSize: 20,
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
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: tokens.color.blueSoft,
  },
  identityBody: {
    flex: 1,
    gap: 2,
  },
  identityLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
  identityId: {
    fontSize: 17,
    color: tokens.theme.light.ink,
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
  empty: {
    paddingVertical: 12,
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
  },
  field: {
    gap: 10,
  },
  contact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.theme.light.inkFaint,
  },
  contactBody: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 18,
    fontWeight: "600",
    color: tokens.theme.light.ink,
  },
  contactId: {
    fontSize: 14,
    color: tokens.theme.light.inkSoft,
  },
  contactAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
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
