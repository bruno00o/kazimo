import { getLocales } from "expo-localization";

export interface Strings {
  pairTitle: string;
  pairBody: string;
  pairScan: string;
  pairManual: string;
  pairFrameId: string;
  pairFrameIdPlaceholder: string;
  pairCode: string;
  pairCodePlaceholder: string;
  pairAction: string;
  pairWaiting: string;
  pairDone: string;
  pairDoneBody: string;
  pairFailed: string;
  frameTitle: string;
  frameLinkedTo: string;
  frameLoading: string;
  frameLoadFailed: string;
  frameContacts: string;
  frameContactsBody: string;
  frameNoContacts: string;
  frameName: string;
  frameNamePlaceholder: string;
  frameAddContact: string;
  frameAddFailed: string;
  frameRemoveContact: string;
  frameRemoveFailed: string;
  frameRemoveConfirmBody: string;
  frameRemove: string;
  frameAdmins: string;
  frameAdminsBody: string;
  framePromote: string;
  framePromoteConfirmBody: string;
  framePromoteFailed: string;
  newConversation: string;
  newDirect: string;
  newGroup: string;
  matrixId: string;
  matrixIdPlaceholder: string;
  groupName: string;
  groupNamePlaceholder: string;
  addMember: string;
  create: string;
  createFailed: string;
  locale: string;
  syncing: string;
  tokenMissing: string;
  conversations: string;
  noConversations: string;
  noConversationsHint: string;
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
  pairTitle: "Add a frame",
  pairBody: "Scan the QR code shown on the Kazimo frame, or enter its code manually.",
  pairScan: "Scan the code",
  pairManual: "Enter manually",
  pairFrameId: "Frame ID",
  pairFrameIdPlaceholder: "@frame:server",
  pairCode: "Pairing code",
  pairCodePlaceholder: "xxxx-xxxx",
  pairAction: "Pair",
  pairWaiting: "Waiting for the frame",
  pairDone: "Frame paired",
  pairDoneBody: "You are now the administrator of this frame.",
  pairFailed: "The frame did not accept the code. Check it and try again.",
  frameTitle: "Frame",
  frameLinkedTo: "Linked frame",
  frameLoading: "Loading the frame",
  frameLoadFailed: "The frame contacts could not be loaded.",
  frameContacts: "Contacts",
  frameContactsBody: "The frame shows these people and calls them.",
  frameNoContacts: "No contacts yet",
  frameName: "Name shown on the frame",
  frameNamePlaceholder: "Maria",
  frameAddContact: "Add the contact",
  frameAddFailed: "The contact could not be added.",
  frameRemoveContact: "Remove the contact",
  frameRemoveFailed: "The contact could not be removed.",
  frameRemoveConfirmBody: "The frame will no longer show this person.",
  frameRemove: "Remove",
  frameAdmins: "Administrators",
  frameAdminsBody: "An administrator can manage the contacts of this frame.",
  framePromote: "Make administrator",
  framePromoteConfirmBody: "This person will be able to manage the contacts of the frame.",
  framePromoteFailed: "This person could not be made administrator.",
  newConversation: "New conversation",
  newDirect: "New message",
  newGroup: "New group",
  matrixId: "Matrix ID",
  matrixIdPlaceholder: "@name:server",
  groupName: "Group name",
  groupNamePlaceholder: "Family",
  addMember: "Add a member",
  create: "Create",
  createFailed: "The conversation could not be created.",
  syncing: "Syncing",
  tokenMissing: "Token missing.",
  conversations: "Conversations",
  noConversations: "No conversations yet",
  noConversationsHint: "Start a conversation with your family.",
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
  pairTitle: "Ajouter un cadre",
  pairBody: "Scannez le QR code affiché sur le cadre Kazimo, ou saisissez son code manuellement.",
  pairScan: "Scanner le code",
  pairManual: "Saisir manuellement",
  pairFrameId: "Identifiant du cadre",
  pairFrameIdPlaceholder: "@cadre:serveur",
  pairCode: "Code de jumelage",
  pairCodePlaceholder: "xxxx-xxxx",
  pairAction: "Jumeler",
  pairWaiting: "En attente du cadre",
  pairDone: "Cadre jumelé",
  pairDoneBody: "Vous êtes maintenant l'administrateur de ce cadre.",
  pairFailed: "Le cadre n'a pas accepté le code. Vérifiez-le et réessayez.",
  frameTitle: "Cadre",
  frameLinkedTo: "Cadre jumelé",
  frameLoading: "Chargement du cadre",
  frameLoadFailed: "Les contacts du cadre n'ont pas pu être chargés.",
  frameContacts: "Contacts",
  frameContactsBody: "Le cadre affiche ces personnes et les appelle.",
  frameNoContacts: "Pas encore de contact",
  frameName: "Nom affiché sur le cadre",
  frameNamePlaceholder: "Maria",
  frameAddContact: "Ajouter le contact",
  frameAddFailed: "Le contact n'a pas pu être ajouté.",
  frameRemoveContact: "Retirer le contact",
  frameRemoveFailed: "Le contact n'a pas pu être retiré.",
  frameRemoveConfirmBody: "Le cadre n'affichera plus cette personne.",
  frameRemove: "Retirer",
  frameAdmins: "Administrateurs",
  frameAdminsBody: "Un administrateur peut gérer les contacts de ce cadre.",
  framePromote: "Nommer administrateur",
  framePromoteConfirmBody: "Cette personne pourra gérer les contacts du cadre.",
  framePromoteFailed: "Cette personne n'a pas pu être nommée administrateur.",
  newConversation: "Nouvelle conversation",
  newDirect: "Nouveau message",
  newGroup: "Nouveau groupe",
  matrixId: "Identifiant Matrix",
  matrixIdPlaceholder: "@nom:serveur",
  groupName: "Nom du groupe",
  groupNamePlaceholder: "Famille",
  addMember: "Ajouter un membre",
  create: "Créer",
  createFailed: "La conversation n'a pas pu être créée.",
  syncing: "Synchronisation",
  tokenMissing: "Jeton manquant.",
  conversations: "Conversations",
  noConversations: "Pas encore de conversation",
  noConversationsHint: "Commencez une conversation avec votre famille.",
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
  pairTitle: "Adicionar uma moldura",
  pairBody: "Digitaliza o código QR mostrado na moldura Kazimo, ou introduz o código manualmente.",
  pairScan: "Digitalizar o código",
  pairManual: "Introduzir manualmente",
  pairFrameId: "Identificador da moldura",
  pairFrameIdPlaceholder: "@moldura:servidor",
  pairCode: "Código de emparelhamento",
  pairCodePlaceholder: "xxxx-xxxx",
  pairAction: "Emparelhar",
  pairWaiting: "À espera da moldura",
  pairDone: "Moldura emparelhada",
  pairDoneBody: "És agora o administrador desta moldura.",
  pairFailed: "A moldura não aceitou o código. Verifica-o e tenta novamente.",
  frameTitle: "Moldura",
  frameLinkedTo: "Moldura emparelhada",
  frameLoading: "A carregar a moldura",
  frameLoadFailed: "Não foi possível carregar os contactos da moldura.",
  frameContacts: "Contactos",
  frameContactsBody: "A moldura mostra estas pessoas e liga-lhes.",
  frameNoContacts: "Ainda sem contactos",
  frameName: "Nome mostrado na moldura",
  frameNamePlaceholder: "Maria",
  frameAddContact: "Adicionar o contacto",
  frameAddFailed: "Não foi possível adicionar o contacto.",
  frameRemoveContact: "Remover o contacto",
  frameRemoveFailed: "Não foi possível remover o contacto.",
  frameRemoveConfirmBody: "A moldura deixa de mostrar esta pessoa.",
  frameRemove: "Remover",
  frameAdmins: "Administradores",
  frameAdminsBody: "Um administrador pode gerir os contactos desta moldura.",
  framePromote: "Tornar administrador",
  framePromoteConfirmBody: "Esta pessoa passa a poder gerir os contactos da moldura.",
  framePromoteFailed: "Não foi possível tornar esta pessoa administrador.",
  newConversation: "Nova conversa",
  newDirect: "Nova mensagem",
  newGroup: "Novo grupo",
  matrixId: "Identificador Matrix",
  matrixIdPlaceholder: "@nome:servidor",
  groupName: "Nome do grupo",
  groupNamePlaceholder: "Família",
  addMember: "Adicionar um membro",
  create: "Criar",
  createFailed: "Não foi possível criar a conversa.",
  syncing: "A sincronizar",
  tokenMissing: "Falta o token.",
  conversations: "Conversas",
  noConversations: "Ainda sem conversas",
  noConversationsHint: "Começa uma conversa com a tua família.",
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
  pairTitle: "Añadir un marco",
  pairBody: "Escanea el código QR mostrado en el marco Kazimo, o introduce su código manualmente.",
  pairScan: "Escanear el código",
  pairManual: "Introducir manualmente",
  pairFrameId: "Identificador del marco",
  pairFrameIdPlaceholder: "@marco:servidor",
  pairCode: "Código de emparejamiento",
  pairCodePlaceholder: "xxxx-xxxx",
  pairAction: "Emparejar",
  pairWaiting: "Esperando al marco",
  pairDone: "Marco emparejado",
  pairDoneBody: "Ahora eres el administrador de este marco.",
  pairFailed: "El marco no aceptó el código. Compruébalo e inténtalo de nuevo.",
  frameTitle: "Marco",
  frameLinkedTo: "Marco emparejado",
  frameLoading: "Cargando el marco",
  frameLoadFailed: "No se pudieron cargar los contactos del marco.",
  frameContacts: "Contactos",
  frameContactsBody: "El marco muestra a estas personas y las llama.",
  frameNoContacts: "Aún no hay contactos",
  frameName: "Nombre mostrado en el marco",
  frameNamePlaceholder: "Maria",
  frameAddContact: "Añadir el contacto",
  frameAddFailed: "No se pudo añadir el contacto.",
  frameRemoveContact: "Quitar el contacto",
  frameRemoveFailed: "No se pudo quitar el contacto.",
  frameRemoveConfirmBody: "El marco dejará de mostrar a esta persona.",
  frameRemove: "Quitar",
  frameAdmins: "Administradores",
  frameAdminsBody: "Un administrador puede gestionar los contactos de este marco.",
  framePromote: "Hacer administrador",
  framePromoteConfirmBody: "Esta persona podrá gestionar los contactos del marco.",
  framePromoteFailed: "No se pudo hacer administrador a esta persona.",
  newConversation: "Nueva conversación",
  newDirect: "Nuevo mensaje",
  newGroup: "Nuevo grupo",
  matrixId: "Identificador Matrix",
  matrixIdPlaceholder: "@nombre:servidor",
  groupName: "Nombre del grupo",
  groupNamePlaceholder: "Familia",
  addMember: "Añadir un miembro",
  create: "Crear",
  createFailed: "No se pudo crear la conversación.",
  syncing: "Sincronizando",
  tokenMissing: "Falta el token.",
  conversations: "Conversaciones",
  noConversations: "Aún no hay conversaciones",
  noConversationsHint: "Empieza una conversación con tu familia.",
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
