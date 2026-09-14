const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withProguard = (config) => {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.projectRoot || config.projectRoot || process.cwd();
      const destDir = path.join(projectRoot, 'android', 'app');
      const destFile = path.join(destDir, 'proguard-rules.pro');
      const srcFile = path.resolve(__dirname, 'proguard-rules.pro');

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcFile, destFile);

      return modConfig;
    },
  ]);
};

module.exports = withProguard;
