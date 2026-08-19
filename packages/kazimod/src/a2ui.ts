import { A2UI_ICONS, type A2uiNode } from "@kazimo/shared";
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

const ComposerReply = Schema.Struct({ tree: Schema.NullOr(A2uiTree) });

export const decodeComposerReply = Schema.decodeUnknownSync(ComposerReply);
