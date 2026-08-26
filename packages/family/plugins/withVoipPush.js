const fs = require("node:fs");
const path = require("node:path");
const { withAppDelegate, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const HEADER_SEARCH_PATH = `"$(SRCROOT)/../node_modules/react-native-voip-push-notification/ios/RNVoipPushNotification"`;
const BRIDGING_IMPORT = '#import "RNVoipPushNotificationManager.h"';
const PUSHKIT_IMPORT = "import PushKit";
const CLASS_HEAD = "class AppDelegate: ExpoAppDelegate {";
const CONFORMING_CLASS_HEAD = "class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {";

const DELEGATE_METHODS = `
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
    completion()
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

const withVoipBridgingHeader = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const name = cfg.modRequest.projectName;
      const header = path.join(cfg.modRequest.platformProjectRoot, name, `${name}-Bridging-Header.h`);
      if (!fs.existsSync(header)) return cfg;
      const contents = fs.readFileSync(header, "utf8");
      if (contents.includes(BRIDGING_IMPORT)) return cfg;
      fs.writeFileSync(header, `${contents.trimEnd()}\n${BRIDGING_IMPORT}\n`);
      return cfg;
    },
  ]);

const withVoipAppDelegate = (config) =>
  withAppDelegate(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes(PUSHKIT_IMPORT)) {
      contents = contents.replace("import React", `import React\n${PUSHKIT_IMPORT}`);
    }
    if (contents.includes(CLASS_HEAD)) {
      contents = contents.replace(CLASS_HEAD, `${CONFORMING_CLASS_HEAD}\n${DELEGATE_METHODS}`);
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = (config) => withVoipAppDelegate(withVoipBridgingHeader(withVoipHeaderSearchPath(config)));
