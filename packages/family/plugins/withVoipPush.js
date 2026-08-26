const fs = require("node:fs");
const path = require("node:path");
const { withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

const BACKGROUND_MODES = ["audio", "voip"];
const HEADER_SEARCH_PATH = `"$(SRCROOT)/../node_modules/react-native-voip-push-notification/ios/RNVoipPushNotification"`;
const BRIDGING_IMPORTS = ['#import "RNVoipPushNotificationManager.h"', '#import "RNCallKeep.h"'];
const PUSHKIT_IMPORT = "import PushKit";
const CLASS_HEAD = "class AppDelegate: ExpoAppDelegate {";
const CONFORMING_CLASS_HEAD = "class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {";
const LAUNCH_ANCHOR = "    let delegate = ReactNativeDelegate()";
const VOIP_REGISTRATION = "    RNVoipPushNotificationManager.voipRegistration()";

const DELEGATE_METHODS = `
  private static let ringPayloadVersion = 1
  private static let ringHandleType = "generic"
  private static let ringHasVideo = true
  private static let ringFallbackName = "Kazimo"
  private static let ringFailedReason: Int32 = 1

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate credentials: PKPushCredentials,
    for type: PKPushType
  ) {
    RNVoipPushNotificationManager.didUpdate(credentials, forType: type.rawValue)
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)

    let ring = payload.dictionaryPayload
    let version = ring["v"] as? Int
    let roomId = ring["roomId"] as? String
    let callerName = ring["callerName"] as? String ?? Self.ringFallbackName
    let expiresAt = (ring["expiresAt"] as? NSNumber)?.doubleValue ?? 0
    let live = expiresAt > Date().timeIntervalSince1970
    let usable = version == Self.ringPayloadVersion && roomId != nil && live

    var uuid = UUID().uuidString
    if let callId = ring["callId"] as? String, let parsed = UUID(uuidString: callId) {
      uuid = parsed.uuidString
    }

    RNCallKeep.reportNewIncomingCall(
      uuid,
      handle: roomId ?? callerName,
      handleType: Self.ringHandleType,
      hasVideo: Self.ringHasVideo,
      localizedCallerName: callerName,
      supportsHolding: false,
      supportsDTMF: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: ring,
      withCompletionHandler: completion
    )

    if !usable {
      RNCallKeep.endCall(withUUID: uuid, reason: Self.ringFailedReason)
    }
  }
`;

const COMMENT_KEY = /_comment$/;

const unquote = (value) => (value ? value.replace(/^"(.*)"$/, "$1") : value);

const ensureHeaderSearchPath = (project) => {
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configurations)) {
    if (COMMENT_KEY.test(key)) continue;
    const settings = configurations[key].buildSettings;
    if (!settings || unquote(settings.PRODUCT_NAME) !== project.productName) continue;
    if (!settings.HEADER_SEARCH_PATHS) settings.HEADER_SEARCH_PATHS = ['"$(inherited)"'];
    if (!settings.HEADER_SEARCH_PATHS.includes(HEADER_SEARCH_PATH)) {
      settings.HEADER_SEARCH_PATHS.push(HEADER_SEARCH_PATH);
    }
  }
};

const withVoipHeaderSearchPath = (config) =>
  withXcodeProject(config, (cfg) => {
    ensureHeaderSearchPath(cfg.modResults);
    return cfg;
  });

const withVoipBackgroundModes = (config) =>
  withInfoPlist(config, (cfg) => {
    const declared = Array.isArray(cfg.modResults.UIBackgroundModes) ? cfg.modResults.UIBackgroundModes : [];
    cfg.modResults.UIBackgroundModes = [
      ...declared,
      ...BACKGROUND_MODES.filter((mode) => !declared.includes(mode)),
    ];
    return cfg;
  });

const withVoipBridgingHeader = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const name = cfg.modRequest.projectName;
      const header = path.join(cfg.modRequest.platformProjectRoot, name, `${name}-Bridging-Header.h`);
      if (!fs.existsSync(header)) return cfg;
      let contents = fs.readFileSync(header, "utf8").trimEnd();
      for (const line of BRIDGING_IMPORTS) {
        if (!contents.includes(line)) contents = `${contents}\n${line}`;
      }
      fs.writeFileSync(header, `${contents}\n`);
      return cfg;
    },
  ]);

const withVoipAppDelegate = (config) =>
  withAppDelegate(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes(PUSHKIT_IMPORT)) {
      contents = contents.replace("import React", `import React\n${PUSHKIT_IMPORT}`);
    }
    if (!contents.includes(VOIP_REGISTRATION)) {
      contents = contents.replace(LAUNCH_ANCHOR, `${VOIP_REGISTRATION}\n${LAUNCH_ANCHOR}`);
    }
    if (contents.includes(CLASS_HEAD)) {
      contents = contents.replace(CLASS_HEAD, `${CONFORMING_CLASS_HEAD}\n${DELEGATE_METHODS}`);
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = (config) =>
  withVoipAppDelegate(withVoipBridgingHeader(withVoipBackgroundModes(withVoipHeaderSearchPath(config))));
