import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { Agent } from "./agent";
import { KioskServer } from "./server";

BunRuntime.runMain(Layer.launch(KioskServer.layer.pipe(Layer.provide(Agent.layer))));
