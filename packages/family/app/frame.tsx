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
import { Failure, Field, PrimaryButton, ScreenHeader, Segmented } from "../src/ui";

const t = appStrings();

const FRAME_ICON_SIZE = 34;
const ROW_ICON_SIZE = 20;

type Tab = "contacts" | "admins";

type Phase = { kind: "loading" } | { kind: "ready"; link: FrameLink };

const LOADING: Phase = { kind: "loading" };

const TAB_OPTIONS = [
  { key: "contacts", label: t.frameContacts },
  { key: "admins", label: t.frameAdmins },
] as const;

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
            .catch((error) => {
              console.error("promote failed", error);
              setFailure(t.framePromoteFailed);
            })
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
      <View style={{ paddingTop: insets.top + 14 }}>
        <ScreenHeader title={t.frameTitle} backLabel={t.cancel} onBack={() => router.back()} />
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

        <Segmented value={tab} options={TAB_OPTIONS} onChange={selectTab} />

        {tab === "contacts" ? (
          <View style={styles.section}>
            <Text style={styles.body}>{t.frameContactsBody}</Text>
            {contacts.length === 0 ? (
              <Text style={styles.emptyLine}>{t.frameNoContacts}</Text>
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

            <Field
              label={t.matrixId}
              value={contactId}
              onChangeText={setContactId}
              placeholder={t.matrixIdPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              editable={!pending}
              onBlur={fillName}
              onEndEditing={fillName}
            />
            <Field
              label={t.frameName}
              value={contactName}
              onChangeText={setContactName}
              placeholder={t.frameNamePlaceholder}
              autoCorrect={false}
              returnKeyType="done"
              editable={!pending}
              onSubmitEditing={() => void addContact()}
            />
            <PrimaryButton
              label={t.frameAddContact}
              icon="add"
              pending={pending}
              onPress={() => void addContact()}
            />
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.body}>{t.frameAdminsBody}</Text>
            <Field
              label={t.matrixId}
              value={adminId}
              onChangeText={setAdminId}
              placeholder={t.matrixIdPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              editable={!pending}
              onSubmitEditing={confirmPromote}
            />
            <PrimaryButton label={t.framePromote} icon="admin" pending={pending} onPress={confirmPromote} />
          </View>
        )}

        <Failure text={failure} />
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
  section: {
    gap: 10,
  },
  body: {
    fontSize: 15,
    color: tokens.theme.light.inkSoft,
  },
  emptyLine: {
    paddingVertical: 12,
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
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
});
