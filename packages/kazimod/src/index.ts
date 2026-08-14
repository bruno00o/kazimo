import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { KioskServer } from "./server";

BunRuntime.runMain(Layer.launch(KioskServer.layer));
