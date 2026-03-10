/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpawnSubagentTool, type SpawnSubagentParams } from './spawn_subagent.js';
import type { TaskResultDisplay } from './tools.js';
import type { Config } from '../config/config.js';
import { SubagentManager } from '../subagents/subagent-manager.js';
import { SubagentTerminateMode } from '../subagents/types.js';
import { SubAgentScope, ContextState } from '../subagents/subagent.js';
import type { SubagentConfig } from '../subagents/types.js';
import type { AnyToolInvocation } from './tools.js';

// Type for accessing protected methods in tests
type SpawnSubagentToolWithProtectedMethods = SpawnSubagentTool & {
  createInvocation: (params: SpawnSubagentParams) => AnyToolInvocation;
};

// Mock dependencies
vi.mock('../subagents/subagent-manager.js');
vi.mock('../subagents/subagent.js');

const MockedSubagentManager = vi.mocked(SubagentManager);
const MockedContextState = vi.mocked(ContextState);

describe('SpawnSubagentTool', () => {
  let config: Config;
  let spawnSubagentTool: SpawnSubagentTool;
  let mockSubagentManager: SubagentManager;

  beforeEach(() => {
    // Create mock config
    config = {
      getSubagentManager: vi.fn(),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
    } as unknown as Config;

    // Setup SubagentManager mock
    mockSubagentManager = {
      loadSubagent: vi.fn(),
      createSubagentScope: vi.fn(),
    } as unknown as SubagentManager;

    MockedSubagentManager.mockImplementation(() => mockSubagentManager);
    vi.mocked(config.getSubagentManager).mockReturnValue(mockSubagentManager);

    // Create SpawnSubagentTool instance
    spawnSubagentTool = new SpawnSubagentTool(config);
  });

  it('should initialize with correct name and properties', () => {
    expect(spawnSubagentTool.name).toBe('spawn_subagent');
    expect(spawnSubagentTool.displayName).toBe('SpawnSubagent');
  });

  describe('SpawnSubagentToolInvocation', () => {
    let mockSubagentScope: SubAgentScope;
    let mockContextState: ContextState;

    beforeEach(() => {
      mockSubagentScope = {
        runNonInteractive: vi.fn().mockResolvedValue(undefined),
        getFinalText: vi.fn().mockReturnValue('Sub-agent task completed'),
        getTerminateMode: vi.fn().mockReturnValue(SubagentTerminateMode.GOAL),
        getExecutionSummary: vi.fn().mockReturnValue({
          rounds: 1,
          totalDurationMs: 100,
          totalToolCalls: 0,
        }),
      } as unknown as SubAgentScope;

      mockContextState = {
        set: vi.fn(),
      } as unknown as ContextState;

      MockedContextState.mockImplementation(() => mockContextState);

      vi.mocked(mockSubagentManager.loadSubagent).mockResolvedValue({
        name: 'general-purpose',
        color: 'blue',
      } as unknown as SubagentConfig);
      vi.mocked(mockSubagentManager.createSubagentScope).mockResolvedValue(
        mockSubagentScope,
      );
    });

    it('should execute subagent successfully', async () => {
      const params: SpawnSubagentParams = {
        name: 'test-task',
        prompt: 'Do something',
        subagent_type: 'general-purpose',
      };

      const invocation = (
        spawnSubagentTool as SpawnSubagentToolWithProtectedMethods
      ).createInvocation(params);
      
      const result = await invocation.execute();

      expect(mockSubagentManager.loadSubagent).toHaveBeenCalledWith('general-purpose');
      expect(mockSubagentManager.createSubagentScope).toHaveBeenCalled();
      expect(mockSubagentScope.runNonInteractive).toHaveBeenCalled();
      expect(result.llmContent).toEqual([{ text: 'Sub-agent task completed' }]);
      expect((result.returnDisplay as TaskResultDisplay).status).toBe('completed');
    });

    it('should handle subagent not found', async () => {
      vi.mocked(mockSubagentManager.loadSubagent).mockResolvedValue(null);

      const params: SpawnSubagentParams = {
        name: 'test-task',
        prompt: 'Do something',
        subagent_type: 'invalid-type',
      };

      const invocation = (
        spawnSubagentTool as SpawnSubagentToolWithProtectedMethods
      ).createInvocation(params);

      const result = await invocation.execute();
      expect(result.llmContent).toContain('Failed to spawn subagent: Subagent "invalid-type" not found.');
      expect((result.returnDisplay as TaskResultDisplay).status).toBe('failed');
    });
  });
});
