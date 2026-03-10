import { Config } from './packages/core/src/config/config.js';
import { getEnvironmentContext } from './packages/core/src/utils/environmentContext.js';

async function verify() {
  const targetDir = process.cwd();
  console.log('Target Dir:', targetDir);

  const config = new Config({
    targetDir: targetDir,
    cwd: targetDir,
    debugMode: true,
    enableAutomaticIndexing: true,
  });

  // We need to initialize the config to set up services
  // await config.initialize();
  // Wait, config.initialize() might fail because of missing environment variables for Gemini, etc.
  // But getEnvironmentContext mostly just needs the WorkspaceContext and FileSystemService.

  const context = await getEnvironmentContext(config);
  console.log('--- GENERATED CONTEXT START ---');
  console.log(context[0].text);
  console.log('--- GENERATED CONTEXT END ---');
}

verify().catch(console.error);
