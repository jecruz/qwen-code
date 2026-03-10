/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';
import type { ToolResult, ToolResultDisplay, TaskResultDisplay } from './tools.js';
import type { Config } from '../config/config.js';
import { SubagentTerminateMode } from '../subagents/types.js';
import { ContextState } from '../subagents/subagent.js';
import {
  SubAgentEventEmitter,
  SubAgentEventType,
  type SubAgentToolCallEvent,
  type SubAgentToolResultEvent,
  type SubAgentFinishEvent,
  type SubAgentErrorEvent,
} from '../subagents/subagent-events.js';
import { createDebugLogger } from '../utils/debugLogger.js';

export interface SpawnSubagentParams {
  name: string;
  prompt: string;
  subagent_type?: string;
}

const debugLogger = createDebugLogger('SPAWN_SUBAGENT');

/**
 * Tool that allows launching sub-agents for parallel task execution.
 */
export class SpawnSubagentTool extends BaseDeclarativeTool<SpawnSubagentParams, ToolResult> {
  static readonly Name: string = ToolNames.SPAWN_SUBAGENT;

  constructor(private readonly config: Config) {
    super(
      SpawnSubagentTool.Name,
      ToolDisplayNames.SPAWN_SUBAGENT,
      'Launch a new agent to handle a specific, independent task in parallel. This is useful for complex workflows where multiple sub-tasks can be performed simultaneously. When the sub-agent is finished, its final report will be returned to you.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A short, descriptive name for the sub-task (e.g., "fix-tests", "research-api")',
          },
          prompt: {
            type: 'string',
            description: 'The detailed instructions for the sub-agent. Include all necessary context and the expected output format.',
          },
          subagent_type: {
            type: 'string',
            description: 'The type of specialized agent to use. Defaults to "general-purpose" if not specified.',
            default: 'general-purpose',
          },
        },
        required: ['name', 'prompt'],
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      },
      true, // isOutputMarkdown
      true, // canUpdateOutput
    );
  }

  protected createInvocation(params: SpawnSubagentParams) {
    return new SpawnSubagentToolInvocation(this.config, params);
  }
}

class SpawnSubagentToolInvocation extends BaseToolInvocation<SpawnSubagentParams, ToolResult> {
  private readonly _eventEmitter: SubAgentEventEmitter;
  private currentDisplay: TaskResultDisplay | null = null;
  private currentToolCalls: NonNullable<TaskResultDisplay['toolCalls']> = [];

  constructor(
    private readonly config: Config,
    params: SpawnSubagentParams,
  ) {
    super(params);
    this._eventEmitter = new SubAgentEventEmitter();
  }

  get eventEmitter(): SubAgentEventEmitter {
    return this._eventEmitter;
  }

  getDescription(): string {
    return `Launching sub-agent "${this.params.name}" to: ${this.params.prompt.substring(0, 50)}${this.params.prompt.length > 50 ? '...' : ''}`;
  }

  private updateDisplay(
    updates: Partial<TaskResultDisplay>,
    updateOutput?: (output: ToolResultDisplay) => void,
  ): void {
    if (!this.currentDisplay) return;
    this.currentDisplay = { ...this.currentDisplay, ...updates };
    if (updateOutput) updateOutput(this.currentDisplay);
  }

  private setupEventListeners(updateOutput?: (output: ToolResultDisplay) => void): void {
    this.eventEmitter.on(SubAgentEventType.START, () => {
      this.updateDisplay({ status: 'running' }, updateOutput);
    });

    this.eventEmitter.on(SubAgentEventType.TOOL_CALL, (event: unknown) => {
      const toolCallEvent = event as SubAgentToolCallEvent;
      if (!toolCallEvent) return;
      this.currentToolCalls.push({
        callId: toolCallEvent.callId,
        name: toolCallEvent.name,
        status: 'executing',
        args: toolCallEvent.args,
        description: toolCallEvent.description,
      });
      this.updateDisplay({ toolCalls: [...this.currentToolCalls] }, updateOutput);
    });

    this.eventEmitter.on(SubAgentEventType.TOOL_RESULT, (event: unknown) => {
      const toolResultEvent = event as SubAgentToolResultEvent;
      if (!toolResultEvent) return;
      const idx = this.currentToolCalls.findIndex((c) => c.callId === toolResultEvent.callId);
      if (idx >= 0) {
        this.currentToolCalls[idx] = {
          ...this.currentToolCalls[idx],
          status: toolResultEvent.success ? 'success' : 'failed',
          error: toolResultEvent.error,
          responseParts: toolResultEvent.responseParts,
        };
        this.updateDisplay({ toolCalls: [...this.currentToolCalls] }, updateOutput);
      }
    });

    this.eventEmitter.on(SubAgentEventType.FINISH, (event: unknown) => {
      const finishEvent = event as SubAgentFinishEvent;
      if (!finishEvent) return;
      this.updateDisplay({
        status: finishEvent.terminateReason === 'GOAL' ? 'completed' : 'failed',
        terminateReason: finishEvent.terminateReason,
      }, updateOutput);
    });

    this.eventEmitter.on(SubAgentEventType.ERROR, (event: unknown) => {
      const errorEvent = event as SubAgentErrorEvent;
      if (!errorEvent) return;
      this.updateDisplay({ status: 'failed', terminateReason: errorEvent.error }, updateOutput);
    });
  }

  async execute(
    signal?: AbortSignal,
    updateOutput?: (output: ToolResultDisplay) => void,
  ): Promise<ToolResult> {
    const subagentManager = this.config.getSubagentManager();
    const subagentType = this.params.subagent_type || 'general-purpose';

    try {
      const subagentConfig = await subagentManager.loadSubagent(subagentType);
      if (!subagentConfig) {
        throw new Error(`Subagent "${subagentType}" not found.`);
      }

      this.currentDisplay = {
        type: 'task_execution',
        subagentName: subagentConfig.name,
        taskDescription: this.params.name,
        taskPrompt: this.params.prompt,
        status: 'running',
        subagentColor: subagentConfig.color,
        toolCalls: [],
      };

      this.setupEventListeners(updateOutput);
      if (updateOutput) updateOutput(this.currentDisplay);

      const subagentScope = await subagentManager.createSubagentScope(
        subagentConfig,
        this.config,
        { eventEmitter: this.eventEmitter },
      );

      const contextState = new ContextState();
      contextState.set('task_prompt', this.params.prompt);

      await subagentScope.runNonInteractive(contextState, signal);

      const finalText = subagentScope.getFinalText() || '';
      const terminateMode = subagentScope.getTerminateMode();
      const success = terminateMode === SubagentTerminateMode.GOAL;
      const executionSummary = subagentScope.getExecutionSummary();

      this.updateDisplay({
        status: success ? 'completed' : 'failed',
        terminateReason: terminateMode || undefined,
        result: finalText,
        executionSummary,
      }, updateOutput);

      return {
        llmContent: [{ text: finalText }],
        returnDisplay: this.currentDisplay!,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      debugLogger.error(`[SpawnSubagentTool] Error: ${errorMessage}`);
      
      const errorDisplay: TaskResultDisplay = {
        ...(this.currentDisplay || {
          type: 'task_execution',
          subagentName: subagentType,
          taskDescription: this.params.name,
          taskPrompt: this.params.prompt,
          status: 'failed',
        }),
        status: 'failed',
        terminateReason: errorMessage,
      };

      return {
        llmContent: `Failed to spawn subagent: ${errorMessage}`,
        returnDisplay: errorDisplay,
      };
    }
  }
}
