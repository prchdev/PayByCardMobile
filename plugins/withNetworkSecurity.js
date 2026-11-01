const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withNetworkSecurity = (config) => {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.projectRoot || config.projectRoot || process.cwd();
      const resDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
      const destFile = path.join(resDir, 'network_security_config.xml');

      if (!fs.existsSync(resDir)) {
        fs.mkdirSync(resDir, { recursive: true });
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config>
        <domain includeSubdomains="true">api.paybycard.in</domain>
        <pin-set expiration="2027-12-31">
            <pin digest="SHA-256">YLh1dUR9y6Kja30RrAn7JKnbQG/uEtLMkBgFF2Fuihg=</pin>
            <pin digest="SHA-256">C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=</pin>
        </pin-set>
    </domain-config>
</network-security-config>
`;

      fs.writeFileSync(destFile, xml.trim() + '\n');
      return modConfig;
    },
  ]);
};

module.exports = withNetworkSecurity;
