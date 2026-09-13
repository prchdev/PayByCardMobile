const { withAppBuildGradle } = require('@expo/config-plugins');
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withProguard = (config) => {
  const withProguardRules = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.projectRoot;
      const destDir = path.join(projectRoot, 'android', 'app');
      const destFile = path.join(destDir, 'proguard-rules.pro');
      const srcFile = path.join(projectRoot, 'plugins', 'proguard-rules.pro');

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcFile, destFile);
    },
  ]);

  return withAppBuildGradle(withProguardRules, (modConfig) => {
    const buildGradle = modConfig.modResults.contents;

    if (!buildGradle.includes('minifyEnabled true')) {
      const releaseBlock = `    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }`;

      buildGradle = buildGradle.replace(
        /android\s*\{/,
        `android {
${releaseBlock}`
      );
    }

    modConfig.modResults.contents = buildGradle;
    return modConfig;
  });
};

module.exports = withProguard;
