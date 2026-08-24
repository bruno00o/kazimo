import { tokens } from "@kazimo/shared";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/session-context";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <SessionProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: tokens.theme.light.ground },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="new" options={{ presentation: "modal" }} />
            <Stack.Screen name="pair" options={{ presentation: "modal" }} />
            <Stack.Screen
              name="call/[roomId]"
              options={{ presentation: "fullScreenModal", animation: "fade" }}
            />
          </Stack>
          <StatusBar style="dark" />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
