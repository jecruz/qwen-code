/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

export type PackageJson = {
  name?: string;
  version: string;
  config?: {
    sandboxImageUri?: string;
  };
  [key: string]: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let packageJson: PackageJson | undefined;

export async function getPackageJson(): Promise<PackageJson | undefined> {
  if (packageJson) {
    return packageJson;
  }

  try {
    // Traverse up to find package.json
    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
      const pkgPath = path.join(currentDir, 'package.json');
      try {
        const content = await fs.readFile(pkgPath, 'utf-8');
        packageJson = JSON.parse(content);
        return packageJson;
      } catch (_e) {
        // Continue searching up
        currentDir = path.dirname(currentDir);
      }
    }
  } catch (_err) {
    // Fallback if needed, but the loop above should handle it
  }

  return undefined;
}
