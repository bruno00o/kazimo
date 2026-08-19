import { A2UI_ICONS, type A2uiIcon, type A2uiNode } from "@kazimo/shared";
import { Schema } from "effect";

const children = Schema.mutable(Schema.Array(Schema.suspend((): Schema.Codec<A2uiNode> => A2uiTree)));

export const A2uiTree = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("title"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("number"),
    value: Schema.String,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    url: Schema.String,
    caption: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("icon"), name: Schema.Literals(A2UI_ICONS) }),
  Schema.Struct({ kind: Schema.Literal("list"), items: Schema.mutable(Schema.Array(Schema.String)) }),
  Schema.Struct({ kind: Schema.Literal("step"), index: Schema.Number, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("divider") }),
  Schema.Struct({ kind: Schema.Literal("card"), children }),
  Schema.Struct({ kind: Schema.Literal("row"), children }),
  Schema.Struct({ kind: Schema.Literal("column"), children }),
]);

type SchemaTree = typeof A2uiTree.Type;
type _schemaFitsShared = [SchemaTree] extends [A2uiNode] ? true : never;
type _sharedFitsSchema = [A2uiNode] extends [SchemaTree] ? true : never;
export type A2uiContractHolds = _schemaFitsShared & _sharedFitsSchema;

export type ComposerNode =
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "number"; value: string; label?: string }
  | { kind: "image"; query: string; caption?: string }
  | { kind: "icon"; name: A2uiIcon }
  | { kind: "list"; items: string[] }
  | { kind: "step"; index: number; text: string }
  | { kind: "divider" }
  | { kind: "card"; children: ComposerNode[] }
  | { kind: "row"; children: ComposerNode[] }
  | { kind: "column"; children: ComposerNode[] };

const composerChildren = Schema.mutable(
  Schema.Array(Schema.suspend((): Schema.Codec<ComposerNode> => ComposerTree)),
);

export const ComposerTree = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("title"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("number"),
    value: Schema.String,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    query: Schema.String,
    caption: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("icon"), name: Schema.Literals(A2UI_ICONS) }),
  Schema.Struct({ kind: Schema.Literal("list"), items: Schema.mutable(Schema.Array(Schema.String)) }),
  Schema.Struct({ kind: Schema.Literal("step"), index: Schema.Number, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("divider") }),
  Schema.Struct({ kind: Schema.Literal("card"), children: composerChildren }),
  Schema.Struct({ kind: Schema.Literal("row"), children: composerChildren }),
  Schema.Struct({ kind: Schema.Literal("column"), children: composerChildren }),
]);

const ComposerReply = Schema.Struct({ tree: Schema.NullOr(ComposerTree) });

export const decodeComposerReply = Schema.decodeUnknownSync(ComposerReply);
