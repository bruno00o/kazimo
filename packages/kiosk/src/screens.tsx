import type { A2uiNode, ActivitySummary, KioskState, Person, PhotoRef } from "@kazimo/shared";
import { tokens } from "@kazimo/shared";
import { MessageSquare, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { A2uiView } from "./a2ui";
import { type BadgeGroup, badgeFor } from "./activity";
import { stringsFor } from "./i18n";
import { useKioskState } from "./state";

function Aurora({ periodMs, color }: { periodMs: number; color?: string }) {
  const style = {
    "--aurora-period": `${periodMs}ms`,
    ...(color && { "--aurora-color": color }),
  } as React.CSSProperties;
  return <div className="aurora" style={style} />;
}

function Clock({ locale }: { locale: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <div className="clock">{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="date">
        {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </>
  );
}

function Avatar({ person, size }: { person: Person; size: string }) {
  if (person.avatarUrl) {
    return <img className="avatar" src={person.avatarUrl} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <div className="avatar-fallback" style={{ width: size, height: size, fontSize: `calc(${size} / 2.3)` }}>
      {person.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

const MAX_BADGE_NAMES = 2;

const groupNames = (groups: BadgeGroup[], others: string) => {
  const shown = groups
    .slice(0, MAX_BADGE_NAMES)
    .map((group) => group.name)
    .join(", ");
  return groups.length > MAX_BADGE_NAMES ? `${shown} ${others}` : shown;
};

function ActivityBadges({
  activity,
  hint,
  others,
}: {
  activity?: ActivitySummary;
  hint: string;
  others: string;
}) {
  const badge = badgeFor(activity);
  if (!badge) return null;
  return (
    <div className="activity-badges">
      <div className="activity-pills">
        {badge.missed.length > 0 && (
          <div className="activity-pill">
            <Phone fill="currentColor" />
            <span>{groupNames(badge.missed, others)}</span>
          </div>
        )}
        {badge.unread.length > 0 && (
          <div className="activity-pill">
            <MessageSquare fill="currentColor" />
            <span>{groupNames(badge.unread, others)}</span>
          </div>
        )}
      </div>
      <div className="activity-hint">{hint}</div>
    </div>
  );
}

export function IdleScreen({
  photo,
  locale,
  activity,
  badgeHint,
  badgeOthers,
}: {
  photo: PhotoRef | null;
  locale: string;
  activity?: ActivitySummary;
  badgeHint: string;
  badgeOthers: string;
}) {
  if (photo) {
    return (
      <div className="screen theme-dark">
        <img className="photo-backdrop" src={photo.url} alt="" />
        <img className="photo-full" src={photo.url} alt="" />
        {photo.caption && (
          <>
            <div className="photo-scrim" />
            <div className="photo-caption">{photo.caption}</div>
          </>
        )}
        <ActivityBadges activity={activity} hint={badgeHint} others={badgeOthers} />
      </div>
    );
  }
  return (
    <div className="screen theme-dark">
      <Aurora periodMs={tokens.breath.idleMs} />
      <Clock locale={locale} />
      <ActivityBadges activity={activity} hint={badgeHint} others={badgeOthers} />
    </div>
  );
}

export function IncomingCallScreen({ caller, verb }: { caller: Person; verb: string }) {
  return (
    <div className="screen theme-light">
      <Aurora periodMs={tokens.breath.callMs} />
      <div className="rings" style={{ width: "34vh", height: "34vh" }}>
        <div className="ring" />
        <div className="ring" />
        <Avatar person={caller} size="34vh" />
      </div>
      <div className="name">{caller.displayName}</div>
      <div className="soft">{verb}</div>
    </div>
  );
}

export function InCallScreen({ children }: { children?: React.ReactNode }) {
  return (
    <div id="call-container" style={{ position: "fixed", inset: 0, background: tokens.theme.dark.ground }}>
      {children}
    </div>
  );
}

export function MessageScreen({ from, text, photo }: { from: Person; text?: string; photo?: PhotoRef }) {
  return (
    <div className="screen theme-light">
      <Aurora periodMs={tokens.breath.idleMs} />
      {photo && <img className="message-photo" src={photo.url} alt="" />}
      <div className="sender">{from.displayName}</div>
      {text && <div className="message-text">{text}</div>}
      {photo?.caption && <div className="caption">{photo.caption}</div>}
    </div>
  );
}

export function AssistantScreen({ tree }: { tree: A2uiNode }) {
  return (
    <div className="screen theme-light">
      <A2uiView tree={tree} />
    </div>
  );
}

export function DegradedScreen({
  reason,
  title,
  subtitle,
}: {
  reason: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="screen theme-light">
      <Aurora periodMs={tokens.breath.idleMs} color="rgba(95, 99, 104, 0.14)" />
      <div className="degraded-title">{title}</div>
      <div className="degraded-subtitle">{subtitle}</div>
      <div className="hint">{reason}</div>
    </div>
  );
}

export function ScreenFor({ state }: { state: KioskState }) {
  const { lang } = useKioskState();
  const strings = stringsFor(lang);

  switch (state.kind) {
    case "idle":
      return (
        <IdleScreen
          photo={state.photo}
          locale={strings.locale}
          activity={state.activity}
          badgeHint={strings.badgeHint}
          badgeOthers={strings.badgeOthers}
        />
      );
    case "incoming-call":
      return <IncomingCallScreen caller={state.caller} verb={strings.incomingCall} />;
    case "in-call":
      return <InCallScreen />;
    case "message":
      return <MessageScreen from={state.from} text={state.text} photo={state.photo} />;
    case "assistant":
      return <AssistantScreen tree={state.tree} />;
    case "degraded":
      return (
        <DegradedScreen
          reason={state.reason}
          title={strings.degradedTitle}
          subtitle={strings.degradedSubtitle}
        />
      );
    default:
      return (
        <IdleScreen
          photo={null}
          locale={strings.locale}
          badgeHint={strings.badgeHint}
          badgeOthers={strings.badgeOthers}
        />
      );
  }
}
