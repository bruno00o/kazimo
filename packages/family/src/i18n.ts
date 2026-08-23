import { getLocales } from "expo-localization";

export interface Strings {
  locale: string;
  syncing: string;
  tokenMissing: string;
  conversations: string;
  noConversations: string;
  photo: string;
  you: string;
  messagePlaceholder: string;
  send: string;
  call: string;
  loadingMessages: string;
  preparingCall: string;
  waitingVideo: string;
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
  conversations: "Conversations",
  noConversations: "No conversations yet",
  photo: "Photo",
  you: "You",
  messagePlaceholder: "Message",
  send: "Send",
  call: "Call",
  loadingMessages: "Loading messages",
  preparingCall: "Preparing the call",
  waitingVideo: "Waiting for video",
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
  conversations: "Conversations",
  noConversations: "Pas encore de conversation",
  photo: "Photo",
  you: "Vous",
  messagePlaceholder: "Message",
  send: "Envoyer",
  call: "Appeler",
  loadingMessages: "Chargement des messages",
  preparingCall: "Préparation de l'appel",
  waitingVideo: "En attente de la vidéo",
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
  conversations: "Conversas",
  noConversations: "Ainda sem conversas",
  photo: "Foto",
  you: "Tu",
  messagePlaceholder: "Mensagem",
  send: "Enviar",
  call: "Ligar",
  loadingMessages: "A carregar mensagens",
  preparingCall: "A preparar a chamada",
  waitingVideo: "À espera de vídeo",
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
  conversations: "Conversaciones",
  noConversations: "Aún no hay conversaciones",
  photo: "Foto",
  you: "Tú",
  messagePlaceholder: "Mensaje",
  send: "Enviar",
  call: "Llamar",
  loadingMessages: "Cargando mensajes",
  preparingCall: "Preparando la llamada",
  waitingVideo: "Esperando el vídeo",
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
