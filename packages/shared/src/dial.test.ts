/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { type DialCommand, encodeDialCommand, parseDialEvent } from "./dial";

describe("parseDialEvent", () => {
  test("reads every upstream message", () => {
    expect(parseDialEvent('{"t":"hello","fw":"1.0.0"}')).toEqual({ t: "hello", fw: "1.0.0" });
    expect(parseDialEvent('{"t":"wheel","d":1}')).toEqual({ t: "wheel", d: 1 });
    expect(parseDialEvent('{"t":"wheel","d":-1}')).toEqual({ t: "wheel", d: -1 });
    expect(parseDialEvent('{"t":"button","b":"green","k":"press"}')).toEqual({
      t: "button",
      b: "green",
      k: "press",
    });
    expect(parseDialEvent('{"t":"button","b":"magenta","k":"release"}')).toEqual({
      t: "button",
      b: "magenta",
      k: "release",
    });
    expect(parseDialEvent('{"t":"maintenance"}')).toEqual({ t: "maintenance" });
    expect(parseDialEvent('{"t":"pong"}')).toEqual({ t: "pong" });
  });

  test("tolerates carriage returns and surrounding spaces", () => {
    expect(parseDialEvent('  {"t":"pong"}\r')).toEqual({ t: "pong" });
  });

  test("ignores boot noise, malformed lines and unknown types", () => {
    expect(parseDialEvent("")).toBeNull();
    expect(parseDialEvent("ets Jul 29 2019 12:21:46")).toBeNull();
    expect(parseDialEvent('{"t":"wheel"')).toBeNull();
    expect(parseDialEvent("[1,2,3]")).toBeNull();
    expect(parseDialEvent('{"t":"screensaver"}')).toBeNull();
  });

  test("refuses upstream messages whose payload is off", () => {
    expect(parseDialEvent('{"t":"hello"}')).toBeNull();
    expect(parseDialEvent('{"t":"wheel","d":3}')).toBeNull();
    expect(parseDialEvent('{"t":"wheel","d":"1"}')).toBeNull();
    expect(parseDialEvent('{"t":"button","b":"blue","k":"press"}')).toBeNull();
    expect(parseDialEvent('{"t":"button","b":"green","k":"hold"}')).toBeNull();
  });
});

describe("encodeDialCommand", () => {
  test("frames one command per line", () => {
    expect(encodeDialCommand({ t: "ping" })).toBe('{"t":"ping"}\n');
    expect(encodeDialCommand({ t: "labels", green: "Atender", magenta: "Desligar" })).toBe(
      '{"t":"labels","green":"Atender","magenta":"Desligar"}\n',
    );
  });

  test("keeps a label with a newline inside a single line", () => {
    const encoded = encodeDialCommand({ t: "labels", green: "a\nb", magenta: "" });
    expect(encoded.indexOf("\n")).toBe(encoded.length - 1);
  });

  test("round trips through the parser for shared shapes", () => {
    const command: DialCommand = { t: "labels", green: "Ligar", magenta: "Cancelar" };
    expect(JSON.parse(encodeDialCommand(command))).toEqual(command);
  });
});
