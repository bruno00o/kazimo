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
  encryptedUnavailable: string;
  attachPhoto: string;
  photoSendFailed: string;
  signIn: string;
  signOut: string;
  signingIn: string;
  signInFailed: string;
  homeserver: string;
  homeserverPlaceholder: string;
  welcome: string;
  welcomeBody: string;
  photoFull: string;
  securityTitle: string;
  securityBody: string;
  securityKeyHint: string;
  securityContinue: string;
  securityEnterTitle: string;
  securityEnterBody: string;
  securityEnterPlaceholder: string;
  securityEnterAction: string;
  securityEnterFailed: string;
  securityLater: string;
  audioCall: string;
  videoCall: string;
  markRead: string;
  mute: string;
  unmute: string;
  leaveConversation: string;
  leaveConfirmBody: string;
  leave: string;
  typingOne: string;
  typingMany: string;
  sent: string;
  read: string;
  micOff: string;
  micOn: string;
  cameraOff: string;
  cameraOn: string;
  flipCamera: string;
  speaker: string;
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
  encryptedUnavailable: "This conversation is encrypted and cannot be used from Kazimo yet.",
  attachPhoto: "Send a photo",
  photoSendFailed: "The photo could not be sent.",
  signIn: "Sign in",
  signOut: "Sign out",
  signingIn: "Signing in",
  signInFailed: "Sign in failed.",
  homeserver: "Homeserver",
  homeserverPlaceholder: "matrix.example.org",
  welcome: "Welcome to Kazimo",
  welcomeBody: "Sign in with your family account to see your conversations.",
  photoFull: "Photo",
  securityTitle: "Your security key",
  securityBody: "Keep this key somewhere safe. It unlocks your message history if you change phones.",
  securityKeyHint: "12 groups of 4 characters",
  securityContinue: "I saved it",
  securityEnterTitle: "Unlock your messages",
  securityEnterBody: "Enter your security key to read your encrypted conversations on this phone.",
  securityEnterPlaceholder: "xxxx xxxx xxxx xxxx",
  securityEnterAction: "Unlock",
  securityEnterFailed: "This key does not match. Check it and try again.",
  securityLater: "Later",
  audioCall: "Audio call",
  videoCall: "Video call",
  markRead: "Mark as read",
  mute: "Mute",
  unmute: "Unmute",
  leaveConversation: "Leave conversation",
  leaveConfirmBody: "You will no longer receive messages from this conversation.",
  leave: "Leave",
  typingOne: "is typing",
  typingMany: "are typing",
  sent: "Sent",
  read: "Read",
  micOff: "Mute mic",
  micOn: "Unmute mic",
  cameraOff: "Turn camera off",
  cameraOn: "Turn camera on",
  flipCamera: "Flip camera",
  speaker: "Speaker",
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
  encryptedUnavailable: "Cette conversation est chiffrée et ne peut pas encore être utilisée depuis Kazimo.",
  attachPhoto: "Envoyer une photo",
  photoSendFailed: "La photo n'a pas pu être envoyée.",
  signIn: "Se connecter",
  signOut: "Se déconnecter",
  signingIn: "Connexion",
  signInFailed: "La connexion a échoué.",
  homeserver: "Serveur",
  homeserverPlaceholder: "matrix.exemple.org",
  welcome: "Bienvenue sur Kazimo",
  welcomeBody: "Connectez-vous avec votre compte famille pour voir vos conversations.",
  photoFull: "Photo",
  securityTitle: "Votre clé de sécurité",
  securityBody:
    "Conservez cette clé en lieu sûr. Elle permet de retrouver vos messages si vous changez de téléphone.",
  securityKeyHint: "12 groupes de 4 caractères",
  securityContinue: "Je l'ai notée",
  securityEnterTitle: "Déverrouiller vos messages",
  securityEnterBody:
    "Saisissez votre clé de sécurité pour lire vos conversations chiffrées sur ce téléphone.",
  securityEnterPlaceholder: "xxxx xxxx xxxx xxxx",
  securityEnterAction: "Déverrouiller",
  securityEnterFailed: "Cette clé ne correspond pas. Vérifiez-la et réessayez.",
  securityLater: "Plus tard",
  audioCall: "Appel audio",
  videoCall: "Appel vidéo",
  markRead: "Marquer comme lu",
  mute: "Mettre en sourdine",
  unmute: "Réactiver",
  leaveConversation: "Quitter la conversation",
  leaveConfirmBody: "Vous ne recevrez plus les messages de cette conversation.",
  leave: "Quitter",
  typingOne: "écrit",
  typingMany: "écrivent",
  sent: "Envoyé",
  read: "Lu",
  micOff: "Couper le micro",
  micOn: "Réactiver le micro",
  cameraOff: "Couper la caméra",
  cameraOn: "Activer la caméra",
  flipCamera: "Retourner la caméra",
  speaker: "Haut-parleur",
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
  encryptedUnavailable: "Esta conversa está cifrada e ainda não pode ser usada a partir do Kazimo.",
  attachPhoto: "Enviar uma foto",
  photoSendFailed: "Não foi possível enviar a foto.",
  signIn: "Iniciar sessão",
  signOut: "Terminar sessão",
  signingIn: "A iniciar sessão",
  signInFailed: "Não foi possível iniciar sessão.",
  homeserver: "Servidor",
  homeserverPlaceholder: "matrix.exemplo.org",
  welcome: "Bem-vindo ao Kazimo",
  welcomeBody: "Inicia sessão com a tua conta da família para veres as tuas conversas.",
  photoFull: "Foto",
  securityTitle: "A tua chave de segurança",
  securityBody:
    "Guarda esta chave num lugar seguro. Permite recuperar as tuas mensagens se mudares de telemóvel.",
  securityKeyHint: "12 grupos de 4 caracteres",
  securityContinue: "Já a guardei",
  securityEnterTitle: "Desbloquear as tuas mensagens",
  securityEnterBody: "Introduz a tua chave de segurança para leres as conversas cifradas neste telemóvel.",
  securityEnterPlaceholder: "xxxx xxxx xxxx xxxx",
  securityEnterAction: "Desbloquear",
  securityEnterFailed: "Esta chave não corresponde. Verifica-a e tenta novamente.",
  securityLater: "Mais tarde",
  audioCall: "Chamada de voz",
  videoCall: "Videochamada",
  markRead: "Marcar como lida",
  mute: "Silenciar",
  unmute: "Reativar",
  leaveConversation: "Sair da conversa",
  leaveConfirmBody: "Deixas de receber mensagens desta conversa.",
  leave: "Sair",
  typingOne: "está a escrever",
  typingMany: "estão a escrever",
  sent: "Enviada",
  read: "Lida",
  micOff: "Desligar microfone",
  micOn: "Ligar microfone",
  cameraOff: "Desligar câmara",
  cameraOn: "Ligar câmara",
  flipCamera: "Virar câmara",
  speaker: "Altifalante",
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
  encryptedUnavailable: "Esta conversación está cifrada y aún no se puede usar desde Kazimo.",
  attachPhoto: "Enviar una foto",
  photoSendFailed: "No se pudo enviar la foto.",
  signIn: "Iniciar sesión",
  signOut: "Cerrar sesión",
  signingIn: "Iniciando sesión",
  signInFailed: "No se pudo iniciar sesión.",
  homeserver: "Servidor",
  homeserverPlaceholder: "matrix.ejemplo.org",
  welcome: "Bienvenido a Kazimo",
  welcomeBody: "Inicia sesión con tu cuenta familiar para ver tus conversaciones.",
  photoFull: "Foto",
  securityTitle: "Tu clave de seguridad",
  securityBody:
    "Guarda esta clave en un lugar seguro. Permite recuperar tus mensajes si cambias de teléfono.",
  securityKeyHint: "12 grupos de 4 caracteres",
  securityContinue: "Ya la guardé",
  securityEnterTitle: "Desbloquear tus mensajes",
  securityEnterBody:
    "Introduce tu clave de seguridad para leer tus conversaciones cifradas en este teléfono.",
  securityEnterPlaceholder: "xxxx xxxx xxxx xxxx",
  securityEnterAction: "Desbloquear",
  securityEnterFailed: "Esta clave no coincide. Compruébala e inténtalo de nuevo.",
  securityLater: "Más tarde",
  audioCall: "Llamada de voz",
  videoCall: "Videollamada",
  markRead: "Marcar como leída",
  mute: "Silenciar",
  unmute: "Reactivar",
  leaveConversation: "Salir de la conversación",
  leaveConfirmBody: "Dejarás de recibir mensajes de esta conversación.",
  leave: "Salir",
  typingOne: "está escribiendo",
  typingMany: "están escribiendo",
  sent: "Enviado",
  read: "Leído",
  micOff: "Silenciar micro",
  micOn: "Activar micro",
  cameraOff: "Apagar cámara",
  cameraOn: "Encender cámara",
  flipCamera: "Girar cámara",
  speaker: "Altavoz",
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
