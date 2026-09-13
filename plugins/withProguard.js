const { withAndroidBuildGradle } = require('@expo/config-plugins');

const withProguard = (config) => {
  return withAndroidBuildGradle(config, (modConfig) => {
    const buildGradle = modConfig.modResults.contents;

    if (!buildGradle.includes('minifyEnabled true')) {
      buildGradle = buildGradle.replace(
        /android\s*\{/,
        `android {
    // R8/ProGuard minification enabled for Play Store obfuscation requirements
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }`
      );
    }

    modConfig.modResults.contents = buildGradle;
    return modConfig;
  });
};

module.exports = withProguard;
