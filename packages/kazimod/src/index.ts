import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { Agent } from "./agent";
import { KioskBridge } from "./bridge";
import { Dial } from "./dial";
import { KioskServer } from "./server";

BunRuntime.runMain(
  Layer.launch(
    Layer.merge(
      KioskServer.layer.pipe(Layer.provide(Agent.layer), Layer.provide(KioskBridge.layer)),
      Dial.layer,
    ),
  ),
);
