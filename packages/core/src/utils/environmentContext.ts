/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Part } from '@google/genai';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Config } from '../config/config.js';
import { getFolderStructure } from './getFolderStructure.js';

/**
 * Generates a string describing the current workspace directories and their structures.
 * @param {Config} config - The runtime configuration and services.
 * @returns {Promise<string>} A promise that resolves to the directory context string.
 */
export async function getDirectoryContextString(
  config: Config,
): Promise<string> {
  const workspaceContext = config.getWorkspaceContext();
  const workspaceDirectories = workspaceContext.getDirectories();

  const folderStructures = await Promise.all(
    workspaceDirectories.map((dir) =>
      getFolderStructure(dir, {
        maxItems: 100,
        fileService: config.getFileService(),
      }),
    ),
  );

  const folderStructure = folderStructures.join('\n');

  let workingDirPreamble: string;
  if (workspaceDirectories.length === 1) {
    workingDirPreamble = `I'm currently working in the directory: ${workspaceDirectories[0]}`;
  } else {
    const dirList = workspaceDirectories.map((dir) => `  - ${dir}`).join('\n');
    workingDirPreamble = `I'm currently working in the following directories:\n${dirList}`;
  }

  return `${workingDirPreamble}
Here is the folder structure of the current working directories:

${folderStructure}`;
}

/**
 * Generates an outline of important files in the workspace.
 */
async function getProjectOutline(config: Config): Promise<string> {
  if (!config.getAutomaticIndexingEnabled()) {
    return '';
  }

  const lspClient = config.getLspClient();
  if (!lspClient) {
    return '';
  }

  const workspaceRoot = config.getWorkspaceContext().getDirectories()[0];
  if (!workspaceRoot) {
    return '';
  }

  // Important files to gather outlines for
  const importantFiles = [
    'package.json',
    'README.md',
    'tsconfig.json',
    'src/index.ts',
    'src/main.ts',
    'index.ts',
    'main.ts',
  ];

  const outlines: string[] = [];

  for (const file of importantFiles) {
    const fullPath = path.resolve(workspaceRoot, file);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isFile()) {
        const symbols = await lspClient.documentSymbols(`file://${fullPath}`);
        if (symbols && symbols.length > 0) {
          const symbolList = symbols
            .slice(0, 20) // Limit to top 20 symbols per file
            .map(
              (s: { name: string; kind?: string }) =>
                `  - ${s.name} (${s.kind})`,
            )
            .join('\n');
          outlines.push(`Outline for ${file}:\n${symbolList}`);
        }
      }
    } catch (_error) {
      // Ignore errors if LSP is not ready or file doesn't exist
    }
  }

  if (outlines.length === 0) {
    return '';
  }

  return `\n\nProject Outline (Top-level symbols):\n\n${outlines.join('\n\n')}`;
}

/**
 * Retrieves environment-related information to be included in the chat context.
 * This includes the current working directory, date, operating system, and folder structure.
 * @param {Config} config - The runtime configuration and services.
 * @returns A promise that resolves to an array of `Part` objects containing environment information.
 */
export async function getEnvironmentContext(config: Config): Promise<Part[]> {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const platform = process.platform;
  const directoryContext = await getDirectoryContextString(config);
  const projectOutline = await getProjectOutline(config);

  const context = `
This is the Qwen Code. We are setting up the context for our chat.
Today's date is ${today} (formatted according to the user's locale).
My operating system is: ${platform}
${directoryContext}${projectOutline}
        `.trim();

  return [{ text: context }];
}

export async function getInitialChatHistory(
  config: Config,
  extraHistory?: Content[],
): Promise<Content[]> {
  if (config.getSkipStartupContext()) {
    return extraHistory ? [...extraHistory] : [];
  }

  const envParts = await getEnvironmentContext(config);
  const envContextString = envParts.map((part) => part.text || '').join('\n\n');

  return [
    {
      role: 'user',
      parts: [{ text: envContextString }],
    },
    {
      role: 'model',
      parts: [{ text: 'Got it. Thanks for the context!' }],
    },
    ...(extraHistory ?? []),
  ];
}
