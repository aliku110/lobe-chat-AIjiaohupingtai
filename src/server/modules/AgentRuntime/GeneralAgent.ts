import { AgentInstruction, AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { ChatToolPayload, MessageToolCall } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-server:agent-runtime:chat-agent');

export interface ChatAgentConfig {
  agentConfig?: {
    [key: string]: any;
    maxSteps?: number;
  };
  modelRuntimeConfig?: {
    model: string;
    provider: string;
  };
  sessionId: string;
  userId?: string;
}

export interface GeneralAgentLLMResultPayload {
  hasToolsCalling: boolean;
  result: { content: string; tool_calls: MessageToolCall[] };
  toolsCalling: ChatToolPayload[];
}

export interface GeneralAgentToolResultPayload {
  data: any;
  executionTime: number;
  isSuccess: boolean;
  toolCall: ChatToolPayload;
  toolCallId: string;
}

export class GeneralAgent {
  private config: ChatAgentConfig;

  constructor(config: ChatAgentConfig) {
    this.config = config;
  }

  async runner(
    context: AgentRuntimeContext,
    state: AgentState,
  ): Promise<AgentInstruction | AgentInstruction[]> {
    log('Processing phase: %s for session %s', context.phase, this.config.sessionId);

    switch (context.phase) {
      case 'user_input': {
        // call LLM
        return {
          payload: {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          },
          type: 'call_llm',
        };
      }

      case 'llm_result': {
        // LLM 完成，根据是否有 tools calling 来判断
        const payload = context.payload as GeneralAgentLLMResultPayload;

        // 有 tools 则调 tool
        if (payload.hasToolsCalling) {
          // 使用原始的 tool_calls (MessageToolCall[]) 而不是转换后的 toolsCalling
          const toolCalls = payload.result.tool_calls;

          // 返回工具调用指令数组
          // 如果有多个工具调用，使用批量执行以提高性能
          if (toolCalls.length > 1) {
            return {
              toolsCalling: toolCalls as any, // MessageToolCall[] 兼容 ToolsCalling[]
              type: 'call_tools_batch',
            };
          } else if (toolCalls.length === 1) {
            // 单个工具直接执行
            return {
              toolCall: toolCalls[0] as any, // MessageToolCall 兼容 ToolsCalling
              type: 'call_tool',
            };
          }
        }

        // 没有 tools 则结束
        return {
          reason: 'completed',
          reasonDetail: 'General agent completed successfully',
          type: 'finish',
        };
      }

      case 'tool_result':
      case 'tools_batch_result': {
        // 工具执行完成后，继续调用 LLM
        return {
          payload: {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          },
          type: 'call_llm',
        };
      }

      default: {
        return {
          reason: 'error_recovery',
          reasonDetail: `Unknown phase: ${context.phase}`,
          type: 'finish',
        };
      }
    }
  }

  /**
   * 空工具注册表
   */
  tools = {};

  /**
   * 获取配置
   */
  getConfig() {
    return this.config;
  }
}
