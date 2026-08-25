import { tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
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
import { Failure, Field, PrimaryButton, ScreenHeader, Segmented } from "../src/ui";

const t = appStrings();

const ADD_ICON_SIZE = 20;

type Kind = "direct" | "group";

type Member = { key: string; value: string };

type Plan =
  | { kind: "direct"; userId: string }
  | { kind: "group"; name: string; memberIds: readonly string[] };

const KIND_OPTIONS = [
  { key: "direct", label: t.newDirect },
  { key: "group", label: t.newGroup },
] as const;

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
      <View style={{ paddingTop: insets.top + 14 }}>
        <ScreenHeader title={t.newConversation} backLabel={t.cancel} onBack={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Segmented value={kind} options={KIND_OPTIONS} onChange={setKind} />

        {kind === "direct" ? (
          <Field
            label={t.matrixId}
            value={directId}
            onChangeText={setDirectId}
            placeholder={t.matrixIdPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            editable={!pending}
            onSubmitEditing={() => void submit()}
          />
        ) : (
          <View style={styles.fields}>
            <Field
              label={t.groupName}
              value={groupName}
              onChangeText={setGroupName}
              placeholder={t.groupNamePlaceholder}
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
              editable={!pending}
            />
            <Text style={styles.membersLabel}>{t.matrixId}</Text>
            {members.map((member) => (
              <TextInput
                key={member.key}
                style={styles.memberInput}
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

        <PrimaryButton label={t.create} pending={pending} onPress={() => void submit()} />
        <Failure text={failed ? t.createFailed : null} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.theme.light.ground,
  },
  form: {
    gap: 16,
    padding: 20,
  },
  fields: {
    gap: 10,
  },
  membersLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.theme.light.inkSoft,
  },
  memberInput: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 18,
    color: tokens.theme.light.ink,
    backgroundColor: tokens.theme.light.surface,
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
});
