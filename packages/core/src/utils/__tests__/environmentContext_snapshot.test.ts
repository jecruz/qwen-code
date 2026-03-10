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

describe('getEnvironmentContext snapshot', () => {
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

  it('should include file content for small config files', async () => {
    // Mock package.json existence and content
    vi.mocked(fs.stat).mockImplementation(
      async (filePath: string | Buffer | URL) => {
        if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { isFile: () => true, size: 500 } as any;
        }
        throw new Error('Not found');
      },
    );

    vi.mocked(fs.readFile).mockResolvedValue('{"name": "test-pkg"}');

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).toContain('Project Context Snapshot:');
    expect(context).toContain('--- File: package.json (Full Content) ---');
    expect(context).toContain('{"name": "test-pkg"}');
  });

  it('should include symbol outline for source files', async () => {
    // Mock index.ts existence and symbols
    vi.mocked(fs.stat).mockImplementation(
      async (filePath: string | Buffer | URL) => {
        if (
          typeof filePath === 'string' &&
          (filePath.endsWith('src/index.ts') || filePath.endsWith('index.ts'))
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { isFile: () => true, size: 5000 } as any;
        }
        throw new Error('Not found');
      },
    );

    mockLspClient.documentSymbols.mockResolvedValue([
      { name: 'start', kind: 'Function' },
    ]);

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).toContain('--- File: index.ts (Symbol Outline) ---');
    expect(context).toContain('- start (Function)');
  });

  it('should not include project snapshot when disabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockConfig.getAutomaticIndexingEnabled as any).mockReturnValue(false);

    const parts = await getEnvironmentContext(mockConfig as Config);
    const context = parts[0].text;

    expect(context).not.toContain('Project Context Snapshot:');
  });
});
