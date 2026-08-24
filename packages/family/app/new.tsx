import { tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { createDirect, createGroup, defaultServerFrom, normalizeMatrixId } from "../src/rooms";
import { useSession } from "../src/session-context";

const t = appStrings();

const WHITE = "#ffffff";
const BACK_ICON_SIZE = 26;
const ADD_ICON_SIZE = 20;

type Kind = "direct" | "group";

type Member = { key: string; value: string };

type Plan =
  | { kind: "direct"; userId: string }
  | { kind: "group"; name: string; memberIds: readonly string[] };

const firstMember = (): Member[] => [{ key: "1", value: "" }];

export default function NewConversation() {
  const { client, homeserver } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>("direct");
  const [directId, setDirectId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<Member[]>(firstMember);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const defaultServer = useMemo(() => defaultServerFrom(homeserver) ?? "", [homeserver]);

  const updateMember = useCallback((key: string, value: string) => {
    setMembers((current) => current.map((member) => (member.key === key ? { ...member, value } : member)));
  }, []);

  const appendMember = useCallback(() => {
    setMembers((current) => [...current, { key: String(current.length + 1), value: "" }]);
  }, []);

  const plan = useCallback((): Plan | null => {
    if (kind === "direct") {
      const userId = normalizeMatrixId(directId, defaultServer);
      return userId ? { kind, userId } : null;
    }
    const name = groupName.trim();
    const filled = members.map((member) => member.value).filter((value) => value.trim().length > 0);
    const memberIds = filled
      .map((value) => normalizeMatrixId(value, defaultServer))
      .filter((id): id is string => id !== null);
    const complete = name.length > 0 && memberIds.length > 0 && memberIds.length === filled.length;
    return complete ? { kind, name, memberIds } : null;
  }, [defaultServer, directId, groupName, kind, members]);

  const submit = useCallback(async () => {
    if (pending) return;
    setFailed(false);
    const target = plan();
    if (!target) {
      setFailed(true);
      return;
    }
    setPending(true);
    try {
      const roomId =
        target.kind === "direct"
          ? await createDirect(client, target.userId)
          : await createGroup(client, target.name, target.memberIds);
      router.replace({ pathname: "/chat/[roomId]", params: { roomId } });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [client, pending, plan, router]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { paddingBottom: insets.bottom + 16 }]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable accessibilityRole="button" style={styles.back} onPress={() => router.back()}>
          <Icon name="back" color={tokens.color.blue} size={BACK_ICON_SIZE} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {t.newConversation}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={styles.segmented}>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, kind === "direct" && styles.pillActive]}
            onPress={() => setKind("direct")}
          >
            <Text style={[styles.pillText, kind === "direct" && styles.pillTextActive]}>{t.newDirect}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, kind === "group" && styles.pillActive]}
            onPress={() => setKind("group")}
          >
            <Text style={[styles.pillText, kind === "group" && styles.pillTextActive]}>{t.newGroup}</Text>
          </Pressable>
        </View>

        {kind === "direct" ? (
          <View style={styles.field}>
            <Text style={styles.label}>{t.matrixId}</Text>
            <TextInput
              style={styles.input}
              value={directId}
              onChangeText={setDirectId}
              placeholder={t.matrixIdPlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              editable={!pending}
              onSubmitEditing={() => void submit()}
            />
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.label}>{t.groupName}</Text>
            <TextInput
              style={styles.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder={t.groupNamePlaceholder}
              placeholderTextColor={tokens.theme.light.inkFaint}
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
              editable={!pending}
            />
            <Text style={styles.label}>{t.matrixId}</Text>
            {members.map((member) => (
              <TextInput
                key={member.key}
                style={styles.input}
                value={member.value}
                onChangeText={(value) => updateMember(member.key, value)}
                placeholder={t.matrixIdPlaceholder}
                placeholderTextColor={tokens.theme.light.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                editable={!pending}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              style={styles.addMember}
              disabled={pending}
              onPress={appendMember}
            >
              <Icon name="add" color={tokens.color.blue} size={ADD_ICON_SIZE} />
              <Text style={styles.addMemberText}>{t.addMember}</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[styles.button, pending && styles.buttonDisabled]}
          disabled={pending}
          accessibilityRole="button"
          onPress={() => void submit()}
        >
          {pending && <ActivityIndicator color={WHITE} />}
          <Text style={styles.buttonText}>{t.create}</Text>
        </Pressable>
        {failed && <Text style={styles.failure}>{t.createFailed}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.theme.light.ground,
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
  addMember: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
  },
  addMemberText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.blue,
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
