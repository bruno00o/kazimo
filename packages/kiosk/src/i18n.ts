export interface Strings {
  locale: string;
  incomingCall: string;
  degradedTitle: string;
  degradedSubtitle: string;
}

const en: Strings = {
  locale: "en-GB",
  incomingCall: "is calling…",
  degradedTitle: "I can't connect right now.",
  degradedSubtitle: "Your family has been told.",
};

const fr: Strings = {
  locale: "fr-FR",
  incomingCall: "t'appelle…",
  degradedTitle: "Je n'arrive pas à me connecter.",
  degradedSubtitle: "Ta famille a été prévenue.",
};

const ptPT: Strings = {
  locale: "pt-PT",
  incomingCall: "está a ligar…",
  degradedTitle: "Não consigo ligar-me.",
  degradedSubtitle: "A tua família já foi avisada.",
};

const es: Strings = {
  locale: "es-ES",
  incomingCall: "te está llamando…",
  degradedTitle: "No consigo conectarme.",
  degradedSubtitle: "Tu familia ya está avisada.",
};

const byLang: Record<string, Strings> = { en, fr, es, pt: ptPT, "pt-PT": ptPT };

export function stringsFor(lang: string): Strings {
  return byLang[lang] ?? byLang[lang.split("-")[0] ?? ""] ?? en;
}
