/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "notification-service",
  name: "KazimoNotificationService",
  displayName: "Kazimo Notification Service",
  bundleIdentifier: ".nse",
  deploymentTarget: "16.0",
  frameworks: ["UserNotifications", "Security"],
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
