/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEnvironmentContext } from '../environmentContext.js';
import type { Config } from '../../config/config.js';
import { getFolderStructure } from '../getFolderStructure.js';
import fs from 'node:fs/promises';

vi.mock('../../config/config.js');
vi.mock('../getFolderStructure.js', () => ({
  getFolderStructure: vi.fn(),
}));
vi.mock('node:fs/promises');

describe('getEnvironmentContext outline', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLspClient: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-05T12:00:00Z'));

    mockLspClient = {
      documentSymbols: vi.fn(),
    };

    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getFileService: vi.fn().mockReturnValue({
        getFileStats: vi.fn(),
      }),
      getLspClient: vi.fn().mockReturnValue(mockLspClient),
      getAutomaticIndexingEnabled: vi.fn().mockReturnValue(true),
    };

    vi.mocked(getFolderStructure).mockResolvedValue('Mock Folder Structure');
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('should include project outline when important files exist', async () => {
    // Mock package.json existence and symbols
    vi.mocked(fs.stat).mockImplementation(
      async (filePath: string | Buffer | URL) => {
        if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { isFile: () => true } as any;
        }
        throw new Error('Not found');
      },
    );

    mockLspClient.documentSymbols.mockResolvedValue([
      { name: 'my-package', kind: 'Module' },
      { name: 'version', kind: 'Property' },
    ]);

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).toContain('Project Outline (Top-level symbols):');
    expect(context).toContain('Outline for package.json:');
    expect(context).toContain('- my-package (Module)');
    expect(context).toContain('- version (Property)');
  });

  it('should not include project outline when disabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockConfig.getAutomaticIndexingEnabled as any).mockReturnValue(false);

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).not.toContain('Project Outline (Top-level symbols):');
  });

  it('should handle missing LSP client gracefully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockConfig.getLspClient as any).mockReturnValue(undefined);

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).not.toContain('Project Outline (Top-level symbols):');
  });
});
