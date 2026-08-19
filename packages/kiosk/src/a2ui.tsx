import type { A2uiIcon, A2uiNode } from "@kazimo/shared";
import {
  CalendarDays,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  MessageSquare,
  Moon,
  Music,
  Phone,
  Sun,
  Wind,
} from "lucide-react";

const ICONS: Record<A2uiIcon, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  fog: CloudFog,
  storm: CloudLightning,
  wind: Wind,
  moon: Moon,
  phone: Phone,
  message: MessageSquare,
  calendar: CalendarDays,
  music: Music,
};

const MAX_CONTAINER_DEPTH = 3;
const MAX_ROW_CHILDREN = 2;
const MAX_LEAVES = 12;
const MAX_LIST_ITEMS = 6;

type Container = Extract<A2uiNode, { children: A2uiNode[] }>;

function withKeys<T extends A2uiNode | string>(children: T[]): [string, T][] {
  const seen = new Map<string, number>();
  return children.map((child) => {
    const base = typeof child === "string" ? child : child.kind;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [`${base}-${count}`, child];
  });
}

const isContainer = (node: A2uiNode): node is Container =>
  node.kind === "card" || node.kind === "row" || node.kind === "column";

function cappedRow(children: A2uiNode[]): A2uiNode[] {
  const kept: A2uiNode[] = [];
  let content = 0;
  for (const child of children) {
    if (child.kind === "divider") {
      if (content > 0 && content < MAX_ROW_CHILDREN) kept.push(child);
      continue;
    }
    if (content >= MAX_ROW_CHILDREN) break;
    kept.push(child);
    content += 1;
  }
  while (kept[kept.length - 1]?.kind === "divider") kept.pop();
  return kept;
}

function pruneDepth(node: A2uiNode, containerDepth: number): A2uiNode | null {
  if (!isContainer(node)) return node;
  if (containerDepth >= MAX_CONTAINER_DEPTH) return null;
  const pruned = node.children
    .map((child) => pruneDepth(child, containerDepth + 1))
    .filter((child): child is A2uiNode => child !== null);
  const children = node.kind === "row" ? cappedRow(pruned) : pruned;
  return children.length ? { ...node, children } : null;
}

function capLeaves(node: A2uiNode, budget: { left: number }): A2uiNode | null {
  if (isContainer(node)) {
    const children = node.children
      .map((child) => capLeaves(child, budget))
      .filter((child): child is A2uiNode => child !== null);
    return children.length ? { ...node, children } : null;
  }
  if (budget.left <= 0) return null;
  budget.left -= 1;
  if (node.kind === "list") return { ...node, items: node.items.slice(0, MAX_LIST_ITEMS) };
  return node;
}

export function pruneTree(tree: A2uiNode): A2uiNode | null {
  const depthPruned = pruneDepth(tree, 0);
  return depthPruned ? capLeaves(depthPruned, { left: MAX_LEAVES }) : null;
}

function NodeView({ node, depth }: { node: A2uiNode; depth: number }) {
  const at = (name: string) => `a2ui-${name} a2ui-d${Math.min(depth, MAX_CONTAINER_DEPTH)}`;
  switch (node.kind) {
    case "title":
      return <div className={at("title")}>{node.text}</div>;
    case "text":
      return <div className={at("text")}>{node.text}</div>;
    case "number":
      return (
        <div className={at("number")}>
          <span className="a2ui-number-value">{node.value}</span>
          {node.label && <span className="a2ui-number-label">{node.label}</span>}
        </div>
      );
    case "image":
      return (
        <figure className={at("image")}>
          <img src={node.url} alt="" />
          {node.caption && <figcaption>{node.caption}</figcaption>}
        </figure>
      );
    case "icon": {
      const Icon = ICONS[node.name];
      return (
        <div className={at("icon")}>
          <Icon strokeWidth={2.25} />
        </div>
      );
    }
    case "list":
      return (
        <ul className={at("list")}>
          {withKeys(node.items).map(([key, item]) => (
            <li key={key}>{item}</li>
          ))}
        </ul>
      );
    case "step":
      return (
        <div className={at("step")}>
          <span className="a2ui-step-index">{node.index}</span>
          <span>{node.text}</span>
        </div>
      );
    case "divider":
      return <div className={at("divider")} />;
    case "card":
    case "row":
    case "column":
      return (
        <div className={at(node.kind)}>
          {withKeys(node.children).map(([key, child]) => (
            <NodeView key={key} node={child} depth={depth + 1} />
          ))}
        </div>
      );
  }
}

export function A2uiView({ tree }: { tree: A2uiNode }) {
  const pruned = pruneTree(tree);
  if (!pruned) return null;
  return (
    <div className="a2ui-root">
      <NodeView node={pruned} depth={0} />
    </div>
  );
}
