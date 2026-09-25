import { BunRuntime } from "@effect/platform-bun";
import { Config, Layer, References } from "effect";
import { Agent } from "./agent";
import { KioskBridge } from "./bridge";
import { Dial } from "./dial";
import { Presence } from "./presence";
import { Radar } from "./radar";
import { KioskServer } from "./server";

const logLevel = Layer.effect(
  References.MinimumLogLevel,
  Config.logLevel("KAZIMO_LOG_LEVEL").pipe(Config.withDefault("Info")),
);

BunRuntime.runMain(
  Layer.launch(
    KioskServer.layer.pipe(
      Layer.provide(Agent.layer),
      Layer.provide(KioskBridge.layer),
      Layer.provide(Presence.layer),
      Layer.provide(Layer.merge(Dial.layer, Radar.layer)),
      Layer.provide(logLevel),
    ),
  ),
);
