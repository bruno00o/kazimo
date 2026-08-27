const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const SDK_PACKAGE_PATH = path.join("node_modules", "@unomed", "react-native-matrix-sdk");
const SDK_SWIFT_DIR = "swift";
const SDK_BUILD_DIR = "build";
const XCFRAMEWORK_NAME = "RnMatrixRustSdk.xcframework";
const BINDINGS_DIR = path.join("targets", "KazimoNotificationService", "bindings");
const POD_DIR = path.join("native-pods", "matrix-rust-ffi");
const SWIFT_EXTENSION = ".swift";

const missingSdkMessage = (projectRoot) =>
  `[withMatrixRustBindings] Could not find ${SDK_PACKAGE_PATH} from ${projectRoot}. Run bun install before prebuild.`;

const findSdkRoot = (from) => {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, SDK_PACKAGE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};

const syncBindings = (projectRoot, sdkRoot) => {
  const source = path.join(sdkRoot, SDK_SWIFT_DIR);
  if (!fs.existsSync(source)) {
    throw new Error(`[withMatrixRustBindings] Missing generated bindings at ${source}.`);
  }
  const names = fs.readdirSync(source).filter((name) => name.endsWith(SWIFT_EXTENSION));
  if (names.length === 0) {
    throw new Error(`[withMatrixRustBindings] No ${SWIFT_EXTENSION} bindings found in ${source}.`);
  }
  const destination = path.join(projectRoot, BINDINGS_DIR);
  fs.mkdirSync(destination, { recursive: true });
  for (const existing of fs.readdirSync(destination)) {
    if (!names.includes(existing)) {
      fs.rmSync(path.join(destination, existing), { force: true, recursive: true });
    }
  }
  for (const name of names) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name));
  }
};

const linkXcframework = (projectRoot, sdkRoot) => {
  const source = path.join(sdkRoot, SDK_BUILD_DIR, XCFRAMEWORK_NAME);
  if (!fs.existsSync(source)) {
    throw new Error(`[withMatrixRustBindings] Missing ${XCFRAMEWORK_NAME} at ${source}.`);
  }
  const linkPath = path.join(projectRoot, POD_DIR, XCFRAMEWORK_NAME);
  const target = path.relative(path.dirname(linkPath), source);
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() && fs.readlinkSync(linkPath) === target) return;
  if (existing?.isSymbolicLink()) fs.unlinkSync(linkPath);
  else if (existing) fs.rmSync(linkPath, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
};

module.exports = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const sdkRoot = findSdkRoot(projectRoot);
      if (!sdkRoot) throw new Error(missingSdkMessage(projectRoot));
      syncBindings(projectRoot, sdkRoot);
      linkXcframework(projectRoot, sdkRoot);
      return cfg;
    },
  ]);
