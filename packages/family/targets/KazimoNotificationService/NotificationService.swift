import Foundation
import Security
import UserNotifications

private struct NotificationCredentials: Decodable {
  let homeserver: String
  let userId: String
  let deviceId: String
  let accessToken: String
  let dataPath: String
  let cachePath: String
  let messageLabel: String
  let photoLabel: String
}

private enum SharedKeychain {
  static let accessGroup = "group.com.kazimo.family"
  static let key = "notification-session"
  static let services = ["kazimo-nse:no-auth", "kazimo-nse"]

  static func credentials() -> NotificationCredentials? {
    let account = Data(key.utf8)
    for service in services {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrGeneric as String: account,
        kSecAttrAccount as String: account,
        kSecAttrAccessGroup as String: accessGroup,
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: kCFBooleanTrue as Any
      ]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
        let data = item as? Data,
        let decoded = try? JSONDecoder().decode(NotificationCredentials.self, from: data)
      else { continue }
      return decoded
    }
    return nil
  }
}

private struct PushTarget {
  let roomId: String
  let eventId: String

  init?(userInfo: [AnyHashable: Any]) {
    guard let roomId = userInfo["room_id"] as? String,
      let eventId = userInfo["event_id"] as? String
    else { return nil }
    self.roomId = roomId
    self.eventId = eventId
  }
}

final class NotificationService: UNNotificationServiceExtension {
  private static let processHolderName = "notification-service"
  private static let payloadKey = "body"
  private static let roomKey = "roomId"

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?
  private var labels: NotificationCredentials?
  private var client: Client?
  private var notifications: NotificationClient?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let attempt = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttemptContent = attempt

    guard let target = PushTarget(userInfo: request.content.userInfo),
      let credentials = SharedKeychain.credentials()
    else {
      deliver(status: nil)
      return
    }

    labels = credentials
    attempt.threadIdentifier = target.roomId
    attempt.userInfo[Self.payloadKey] = [Self.roomKey: target.roomId]

    Task {
      let status = try? await resolve(credentials: credentials, target: target)
      deliver(status: status)
      release()
    }
  }

  override func serviceExtensionTimeWillExpire() {
    deliver(status: nil)
    release()
  }

  private func resolve(
    credentials: NotificationCredentials,
    target: PushTarget
  ) async throws -> NotificationStatus {
    let opened = try await ClientBuilder()
      .homeserverUrl(url: credentials.homeserver)
      .sessionPaths(dataPath: credentials.dataPath, cachePath: credentials.cachePath)
      .crossProcessStoreLocksHolderName(holderName: Self.processHolderName)
      .slidingSyncVersionBuilder(versionBuilder: .native)
      .backupDownloadStrategy(backupDownloadStrategy: .afterDecryptionFailure)
      .systemIsMemoryConstrained()
      .build()
    client = opened
    try await opened.restoreSession(
      session: Session(
        accessToken: credentials.accessToken,
        refreshToken: nil,
        userId: credentials.userId,
        deviceId: credentials.deviceId,
        homeserverUrl: credentials.homeserver,
        oidcData: nil,
        slidingSyncVersion: .native
      )
    )
    let reader = try await opened.notificationClient(processSetup: .multipleProcesses)
    notifications = reader
    return try await reader.getNotification(roomId: target.roomId, eventId: target.eventId)
  }

  private func deliver(status: NotificationStatus?) {
    guard let handler = contentHandler, let attempt = bestAttemptContent else { return }
    contentHandler = nil
    switch status {
    case .event(let item):
      apply(item: item, to: attempt)
      handler(attempt)
    case .eventFilteredOut:
      handler(UNMutableNotificationContent())
    default:
      if let fallback = labels?.messageLabel { attempt.body = fallback }
      handler(attempt)
    }
  }

  private func apply(item: NotificationItem, to content: UNMutableNotificationContent) {
    content.title = item.senderInfo.displayName ?? item.roomInfo.displayName
    if !item.roomInfo.isDirect {
      content.subtitle = item.roomInfo.displayName
    }
    if let body = body(of: item.event) {
      content.body = body
    }
  }

  private func body(of event: NotificationEvent) -> String? {
    guard case .timeline(let timeline) = event else { return labels?.messageLabel }
    guard let eventType = try? timeline.eventType() else { return labels?.messageLabel }
    guard case .messageLike(let messageLike) = eventType else { return labels?.messageLabel }
    guard case .roomMessage(let messageType, _) = messageLike else { return labels?.messageLabel }
    switch messageType {
    case .text(let text): return text.body
    case .notice(let notice): return notice.body
    case .emote(let emote): return emote.body
    case .image, .gallery: return labels?.photoLabel
    default: return labels?.messageLabel
    }
  }

  private func release() {
    notifications = nil
    client = nil
    bestAttemptContent = nil
    labels = nil
  }
}
