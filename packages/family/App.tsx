import type { A2uiNode } from "@kazimo/shared";
import { tokens } from "@kazimo/shared";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

const greeting: A2uiNode = { kind: "title", text: "Kazimo" };

export default function App() {
  return (
    <View style={[styles.container, { backgroundColor: tokens.color.blueSoft }]}>
      <Text style={styles.title}>{greeting.kind === "title" ? greeting.text : ""}</Text>
      <Text style={styles.caption}>{`shared tokens resolved (fade ${tokens.fade.inMs}ms)`}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 48,
    fontWeight: "700",
    color: tokens.color.blueDeep,
  },
  caption: {
    marginTop: 12,
    color: tokens.theme.light.inkSoft,
  },
});
