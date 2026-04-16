import type { StreamChunk, UsageInfo } from '../../../core/types';
import type {
  AcpMessageStopParams,
  AcpTextDeltaParams,
  AcpToolExecutionCompletedParams,
  AcpToolExecutionStartedParams,
  AcpToolOutputDeltaParams,
  AcpToolResultParams,
  AcpToolUseStartParams,
} from '../protocol/acpProtocolTypes';

type ChunkEmitter = (chunk: StreamChunk) => void;

/**
 * Maps ACP notifications to StreamChunk types.
 * Adapted from CodexNotificationRouter for the ACP protocol.
 */
export class AcpNotificationRouter {
  // Track tool execution state for output streaming
  private activeToolExecutions = new Set<string>();

  constructor(private readonly emit: ChunkEmitter) {}

  handleNotification(method: string, params: unknown): void {
    switch (method) {
      case 'chat/textDelta':
        this.onTextDelta(params as AcpTextDeltaParams);
        break;
      case 'chat/toolUseStart':
        this.onToolUseStart(params as AcpToolUseStartParams);
        break;
      case 'chat/toolExecutionStarted':
        this.onToolExecutionStarted(params as AcpToolExecutionStartedParams);
        break;
      case 'chat/toolOutputDelta':
        this.onToolOutputDelta(params as AcpToolOutputDeltaParams);
        break;
      case 'chat/toolExecutionCompleted':
        this.onToolExecutionCompleted(params as AcpToolExecutionCompletedParams);
        break;
      case 'chat/toolResult':
        this.onToolResult(params as AcpToolResultParams);
        break;
      case 'chat/messageStop':
        this.onMessageStop(params as AcpMessageStopParams);
        break;
      case 'chat/error':
        this.onError(params as { error: string });
        break;
      default:
        // Unknown notification - ignore
        break;
    }
  }

  private onTextDelta(params: AcpTextDeltaParams): void {
    this.emit({ type: 'text', content: params.delta });
  }

  private onToolUseStart(params: AcpToolUseStartParams): void {
    this.emit({
      type: 'tool_use',
      id: params.toolUseId,
      name: params.name,
      input: params.input,
    });
  }

  private onToolExecutionStarted(params: AcpToolExecutionStartedParams): void {
    this.activeToolExecutions.add(params.toolUseId);
  }

  private onToolOutputDelta(params: AcpToolOutputDeltaParams): void {
    // Only emit output if this tool is actively executing
    if (this.activeToolExecutions.has(params.toolUseId)) {
      this.emit({
        type: 'tool_output',
        id: params.toolUseId,
        content: params.delta,
      });
    }
  }

  private onToolExecutionCompleted(params: AcpToolExecutionCompletedParams): void {
    this.activeToolExecutions.delete(params.toolUseId);
    const isError = params.status === 'error' || params.status === 'timeout';

    this.emit({
      type: 'tool_result',
      id: params.toolUseId,
      content: params.status === 'success' ? 'Completed' : `Failed: ${params.status}`,
      isError,
    });
  }

  private onToolResult(params: AcpToolResultParams): void {
    // Fallback for agents that use toolResult instead of executionStarted/completed
    this.emit({
      type: 'tool_result',
      id: params.toolUseId,
      content: params.content ?? '',
      isError: params.isError ?? false,
    });
  }

  private onMessageStop(_params: AcpMessageStopParams): void {
    // Clear any remaining active tool executions
    this.activeToolExecutions.clear();
    this.emit({ type: 'done' });
  }

  private onError(params: { error: string }): void {
    this.emit({ type: 'error', content: params.error });
  }
}
