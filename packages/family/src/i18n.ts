import { getLocales } from "expo-localization";

export interface Strings {
  locale: string;
  syncing: string;
  tokenMissing: string;
  rooms: string;
  preparingCall: string;
  waitingVideo: string;
  remotes: string;
  hangUp: string;
  stateDisconnected: string;
  stateConnecting: string;
  stateConnected: string;
  stateReconnecting: string;
  callPermissionsTitle: string;
  callPermissionsBody: string;
  cancel: string;
  ok: string;
  callChannel: string;
  inCall: string;
}

const en: Strings = {
  locale: "en-GB",
  syncing: "Syncing",
  tokenMissing: "Token missing.",
  rooms: "rooms",
  preparingCall: "Preparing the call",
  waitingVideo: "Waiting for video",
  remotes: "remote",
  hangUp: "Hang up",
  stateDisconnected: "disconnected",
  stateConnecting: "connecting",
  stateConnected: "connected",
  stateReconnecting: "reconnecting",
  callPermissionsTitle: "Permissions needed",
  callPermissionsBody: "Kazimo needs access to incoming calls",
  cancel: "Cancel",
  ok: "Ok",
  callChannel: "Kazimo calls",
  inCall: "Kazimo in a call",
};

const fr: Strings = {
  locale: "fr-FR",
  syncing: "Synchronisation",
  tokenMissing: "Jeton manquant.",
  rooms: "salons",
  preparingCall: "Préparation de l'appel",
  waitingVideo: "En attente de la vidéo",
  remotes: "distants",
  hangUp: "Raccrocher",
  stateDisconnected: "déconnecté",
  stateConnecting: "connexion",
  stateConnected: "connecté",
  stateReconnecting: "reconnexion",
  callPermissionsTitle: "Permissions requises",
  callPermissionsBody: "Kazimo a besoin d'accéder aux appels entrants",
  cancel: "Annuler",
  ok: "Ok",
  callChannel: "Appels Kazimo",
  inCall: "Kazimo en appel",
};

const ptPT: Strings = {
  locale: "pt-PT",
  syncing: "A sincronizar",
  tokenMissing: "Falta o token.",
  rooms: "salas",
  preparingCall: "A preparar a chamada",
  waitingVideo: "À espera de vídeo",
  remotes: "remotos",
  hangUp: "Terminar",
  stateDisconnected: "desligado",
  stateConnecting: "a ligar",
  stateConnected: "ligado",
  stateReconnecting: "a reconectar",
  callPermissionsTitle: "Permissões necessárias",
  callPermissionsBody: "O Kazimo precisa de aceder às chamadas recebidas",
  cancel: "Cancelar",
  ok: "Ok",
  callChannel: "Chamadas Kazimo",
  inCall: "Kazimo em chamada",
};

const es: Strings = {
  locale: "es-ES",
  syncing: "Sincronizando",
  tokenMissing: "Falta el token.",
  rooms: "salas",
  preparingCall: "Preparando la llamada",
  waitingVideo: "Esperando el vídeo",
  remotes: "remotos",
  hangUp: "Colgar",
  stateDisconnected: "desconectado",
  stateConnecting: "conectando",
  stateConnected: "conectado",
  stateReconnecting: "reconectando",
  callPermissionsTitle: "Permisos necesarios",
  callPermissionsBody: "Kazimo necesita acceder a las llamadas entrantes",
  cancel: "Cancelar",
  ok: "Ok",
  callChannel: "Llamadas Kazimo",
  inCall: "Kazimo en llamada",
};

const byLang: Record<string, Strings> = { en, fr, es, pt: ptPT, "pt-PT": ptPT };

export function stringsFor(lang: string): Strings {
  return byLang[lang] ?? byLang[lang.split("-")[0] ?? ""] ?? en;
}

let cached: Strings | null = null;

export const appStrings = (): Strings => {
  if (!cached) cached = stringsFor(getLocales()[0]?.languageTag ?? "en");
  return cached;
};
