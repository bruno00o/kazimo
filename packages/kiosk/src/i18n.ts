export interface Strings {
  locale: string;
  incomingCall: string;
  degradedTitle: string;
  degradedSubtitle: string;
  badgeHint: string;
  badgeOthers: string;
  pairingPrompt: string;
  dialAnswer: string;
  dialDecline: string;
  dialHangUp: string;
}

const en: Strings = {
  locale: "en-GB",
  incomingCall: "is calling…",
  degradedTitle: "I can't connect right now.",
  degradedSubtitle: "Your family has been told.",
  badgeHint: "Ask Kazimo to read them",
  badgeOthers: "and others",
  pairingPrompt: "Scan this code with the Kazimo app",
  dialAnswer: "Answer",
  dialDecline: "Decline",
  dialHangUp: "Hang up",
};

const fr: Strings = {
  locale: "fr-FR",
  incomingCall: "t'appelle…",
  degradedTitle: "Je n'arrive pas à me connecter.",
  degradedSubtitle: "Ta famille a été prévenue.",
  badgeHint: "Demande à Kazimo de les lire",
  badgeOthers: "et d'autres",
  pairingPrompt: "Scannez ce code avec l'application Kazimo",
  dialAnswer: "Décrocher",
  dialDecline: "Refuser",
  dialHangUp: "Raccrocher",
};

const ptPT: Strings = {
  locale: "pt-PT",
  incomingCall: "está a ligar…",
  degradedTitle: "Não consigo ligar-me.",
  degradedSubtitle: "A tua família já foi avisada.",
  badgeHint: "Pede ao Kazimo para os ler",
  badgeOthers: "e outros",
  pairingPrompt: "Digitaliza este código com a aplicação Kazimo",
  dialAnswer: "Atender",
  dialDecline: "Recusar",
  dialHangUp: "Desligar",
};

const es: Strings = {
  locale: "es-ES",
  incomingCall: "te está llamando…",
  degradedTitle: "No consigo conectarme.",
  degradedSubtitle: "Tu familia ya está avisada.",
  badgeHint: "Pídele a Kazimo que los lea",
  badgeOthers: "y otros",
  pairingPrompt: "Escanea este código con la aplicación Kazimo",
  dialAnswer: "Contestar",
  dialDecline: "Rechazar",
  dialHangUp: "Colgar",
};

const byLang: Record<string, Strings> = { en, fr, es, pt: ptPT, "pt-PT": ptPT };

export function stringsFor(lang: string): Strings {
  return byLang[lang] ?? byLang[lang.split("-")[0] ?? ""] ?? en;
}
