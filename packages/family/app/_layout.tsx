import { tokens } from "@kazimo/shared";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/session-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tokens.theme.light.ground },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen
            name="call/[roomId]"
            options={{ presentation: "fullScreenModal", animation: "fade" }}
          />
        </Stack>
        <StatusBar style="dark" />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
