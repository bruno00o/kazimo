const { withXcodeProject } = require("expo/config-plugins");

module.exports = (config) =>
  withXcodeProject(config, (cfg) => {
    const team = process.env.APPLE_TEAM_ID;
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (!entry || typeof entry !== "object" || !entry.buildSettings) continue;
      entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      if (team) {
        entry.buildSettings.DEVELOPMENT_TEAM = team;
        entry.buildSettings.CODE_SIGN_STYLE = "Automatic";
      }
    }
    return cfg;
  });
