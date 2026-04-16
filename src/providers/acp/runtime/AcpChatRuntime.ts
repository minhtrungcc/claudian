import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnResult,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type { ChatMessage, Conversation, SlashCommand, StreamChunk } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getAcpProviderSettings, type AcpAgentConfig } from '../settings';
import { ACP_PROVIDER_CAPABILITIES } from '../capabilities';
import type {
  AcpChatParams,
  AcpInitializeResult,
  AcpMessage,
  AcpServerCapabilities,
} from '../protocol/acpProtocolTypes';
import type { AcpProcessConfig } from '../transport/AcpProcessManager';
import { AcpProcessManager } from '../transport/AcpProcessManager';
import { AcpNotificationRouter } from './AcpNotificationRouter';
import { AcpServerRequestRouter } from './AcpServerRequestRouter';
import { AcpStdioTransport } from '../transport/AcpStdioTransport';
import { AcpHttpTransport } from '../transport/AcpHttpTransport';
import { AcpWebSocketTransport } from '../transport/AcpWebSocketTransport';
import type { AcpTransport } from '../transport/AcpTransport';

interface ActiveAgentInfo {
  id: string;
  name: string;
  serverInfo: { name: string; version: string };
  capabilities: AcpServerCapabilities;
}

/**
 * ACP provider state stored in Conversation.providerState.
 */
interface AcpProviderState {
  sessionId: string | null;
  agentId?: string;
  agentName?: string;
  messageHistory?: AcpMessage[];
}

/**
 * ACP conversation tracking for context and resumption.
 */
interface AcpConversationState {
  sessionId: string | null;
  messageHistory: AcpMessage[];
  lastMessageId: string | null;
  currentAgentId: string | null;
}

export class AcpChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId = 'acp';

  private plugin: ClaudianPlugin;
  private transport: AcpTransport | null = null;
  private processManager: AcpProcessManager | null = null;
  private notificationRouter: AcpNotificationRouter | null = null;
  private serverRequestRouter = new AcpServerRequestRouter();
  private ready = false;
  private readyListeners = new Set<(ready: boolean) => void>();

  // Active agent info (detected on handshake)
  private activeAgentInfo: ActiveAgentInfo | null = null;

  // Conversation state for session tracking
  private conversationState: AcpConversationState = {
    sessionId: null,
    messageHistory: [],
    lastMessageId: null,
    currentAgentId: null,
  };

  // Chunk buffering for streaming
  private chunkBuffer: StreamChunk[] = [];
  private chunkResolve: (() => void) | null = null;

  // Callbacks
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private subagentHookProvider: (() => SubagentRuntimeState) | null = null;
  private autoTurnCallback: ((result: AutoTurnResult) => void) | null = null;

  // Cancellation
  private canceled = false;
  private currentMessageId: string | null = null;
  private turnMetadata: ChatTurnMetadata = {};

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    // Return dynamic capabilities based on active agent
    if (this.activeAgentInfo?.capabilities) {
      const caps = this.activeAgentInfo.capabilities;
      return {
        ...ACP_PROVIDER_CAPABILITIES,
        supportsImageAttachments: caps.streaming ?? false,
      };
    }
    return ACP_PROVIDER_CAPABILITIES;
  }

  /** Get info about the currently active agent. */
  getActiveAgentInfo(): ActiveAgentInfo | null {
    return this.activeAgentInfo;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    // For ACP, we just need to prepare the text prompt
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: false,
      mcpMentions: new Set(),
    };
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.turnMetadata };
    this.turnMetadata = {};
    return metadata;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {
    // ACP doesn't support resume checkpoints - conversations are resumed via history
  }

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    if (!conversation) {
      this.conversationState = {
        sessionId: null,
        messageHistory: [],
        lastMessageId: null,
        currentAgentId: null,
      };
      return;
    }

    // Restore conversation state from providerState
    const state = conversation.providerState as AcpProviderState | undefined;
    this.conversationState = {
      sessionId: state?.sessionId ?? null,
      messageHistory: state?.messageHistory ?? [],
      lastMessageId: null,
      currentAgentId: state?.agentId ?? null,
    };
  }

  async reloadMcpServers(): Promise<void> {
    // ACP doesn't use MCP in MVP
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    if (this.ready && options?.force !== true) {
      return true;
    }

    const settings = getAcpProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      return false;
    }

    const agentConfig = this.getActiveAgentConfig(settings);
    if (!agentConfig) {
      return false;
    }

    // Start the agent process and transport
    if (!this.transport || !this.transport.isAlive()) {
      await this.startAgent(agentConfig);
    }

    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    await this.ensureReady();

    if (!this.transport) {
      yield { type: 'error', content: 'ACP transport not available' };
      yield { type: 'done' };
      return;
    }

    // Ensure we have a session ID
    if (!this.conversationState.sessionId) {
      this.conversationState.sessionId = this.generateSessionId();
    }

    this.canceled = false;
    this.chunkBuffer = [];
    this.chunkResolve = null;
    this.currentMessageId = null;

    // Track accumulated response for conversation history
    let accumulatedResponse = '';
    let userMessageContent = turn.prompt;

    const enqueueChunk = (chunk: StreamChunk): void => {
      this.chunkBuffer.push(chunk);
      if (this.chunkResolve) {
        this.chunkResolve();
        this.chunkResolve = null;
      }
    };

    // Set up notification router with response tracking
    this.notificationRouter = new AcpNotificationRouter(enqueueChunk);
    this.wireTransportHandlers();

    try {
      // Build ACP chat request
      const acpRequest = this.buildAcpChatRequest(turn);

      // Send chat request
      const result = await this.transport.request<{ messageId: string }>('chat/send', acpRequest);
      this.currentMessageId = result.messageId;
      this.recordTurnMetadata({ userMessageId: result.messageId, wasSent: true });

      // Add user message to history
      this.conversationState.messageHistory.push({
        role: 'user',
        content: userMessageContent,
      });

      // Yield chunks until done or canceled
      while (true) {
        if (this.canceled) {
          // Drain remaining chunks before exiting
          while (this.chunkBuffer.length > 0) {
            const chunk = this.chunkBuffer.shift()!;
            yield chunk;
            if (chunk.type === 'done') return;
          }
          yield { type: 'done' };
          return;
        }

        if (this.chunkBuffer.length === 0) {
          await new Promise<void>((resolve) => {
            this.chunkResolve = resolve;
            if (this.chunkBuffer.length > 0 || this.canceled) {
              resolve();
              this.chunkResolve = null;
            }
          });
        }

        while (this.chunkBuffer.length > 0) {
          const chunk = this.chunkBuffer.shift()!;

          // Track text for conversation history
          if (chunk.type === 'text') {
            accumulatedResponse += chunk.content;
          }

          yield chunk;
          if (chunk.type === 'done') {
            // Add assistant response to history
            if (accumulatedResponse) {
              this.conversationState.messageHistory.push({
                role: 'assistant',
                content: accumulatedResponse,
              });
            }
            return;
          }
        }
      }
    } catch (err: unknown) {
      if (this.canceled) {
        yield { type: 'done' };
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown ACP error';
      yield { type: 'error', content: message };
      yield { type: 'done' };
      return;
    } finally {
      this.currentMessageId = null;
    }
  }

  cancel(): void {
    this.canceled = true;
    this.dismissAllPendingPrompts();

    // Unblock the chunk-wait loop
    if (this.chunkResolve) {
      this.chunkResolve();
      this.chunkResolve = null;
    }
  }

  resetSession(): void {
    this.conversationState.sessionId = null;
    this.conversationState.messageHistory = [];
    this.conversationState.lastMessageId = null;
  }

  getSessionId(): string | null {
    return this.conversationState.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    return false; // ACP doesn't have environment-based invalidation in MVP
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return []; // ACP doesn't have provider commands in MVP
  }

  cleanup(): void {
    this.cancel();
    this.readyListeners.clear();
    this.shutdownTransport().catch(() => {});
  }

  async rewind(_userMessageId: string, _assistantMessageId: string): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'ACP does not support rewind' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
    this.serverRequestRouter.setApprovalCallback(callback);
  }

  setApprovalDismisser(dismisser: (() => void) | null): void {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserCallback = callback;
    this.serverRequestRouter.setAskUserCallback(callback);
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentHookProvider(getState: () => SubagentRuntimeState): void {
    this.subagentHookProvider = getState;
  }

  setAutoTurnCallback(callback: ((result: AutoTurnResult) => void) | null): void {
    this.autoTurnCallback = callback;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const sessionId = this.conversationState.sessionId;

    // Build provider state with session and history
    const providerState: AcpProviderState = {
      sessionId,
      messageHistory: this.conversationState.messageHistory,
    };

    // Include active agent info
    if (this.activeAgentInfo) {
      providerState.agentId = this.activeAgentInfo.id;
      providerState.agentName = this.activeAgentInfo.name;
    }

    const updates: Partial<Conversation> = {
      sessionId,
      providerState: Object.keys(providerState).length > 0 ? (providerState as unknown as Record<string, unknown>) : undefined,
    };

    if (params.sessionInvalidated && params.conversation) {
      updates.sessionId = null;
      updates.providerState = undefined;
    }

    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.conversationState.sessionId ?? conversation?.sessionId ?? null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private generateSessionId(): string {
    return `acp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private getActiveAgentConfig(settings: ReturnType<typeof getAcpProviderSettings>): AcpAgentConfig | null {
    const defaultAgent = settings.agents.find(a => a.id === settings.defaultAgentId);
    const agent = defaultAgent ?? settings.agents.find(a => a.enabled) ?? settings.agents[0];

    if (!agent || !agent.enabled) {
      return null;
    }

    return agent;
  }

  private async startAgent(agentConfig: AcpAgentConfig): Promise<void> {
    this.shutdownTransport().catch(() => {});

    // Initialize transport based on type
    switch (agentConfig.transportType) {
      case 'stdio': {
        if (!agentConfig.command) {
          throw new Error(`ACP agent "${agentConfig.name}" has no command configured`);
        }

        const processConfig: AcpProcessConfig = {
          command: agentConfig.command,
          args: agentConfig.args,
          env: agentConfig.env,
        };

        this.processManager = new AcpProcessManager(processConfig);
        this.processManager.start();

        this.transport = new AcpStdioTransport(
          this.processManager.stdin,
          this.processManager.stdout,
          () => this.handleProcessExit(),
        );
        this.transport.start();
        break;
      }

      case 'http': {
        if (!agentConfig.url) {
          throw new Error(`ACP agent "${agentConfig.name}" has no URL configured`);
        }

        this.transport = new AcpHttpTransport({
          url: agentConfig.url,
          headers: agentConfig.headers,
        });
        this.transport.start();
        break;
      }

      case 'websocket': {
        if (!agentConfig.url) {
          throw new Error(`ACP agent "${agentConfig.name}" has no URL configured`);
        }

        const wsTransport = new AcpWebSocketTransport({
          url: agentConfig.url,
          headers: agentConfig.headers,
        });
        await wsTransport.start();
        this.transport = wsTransport;
        break;
      }

      default:
        throw new Error(`Unknown transport type: ${agentConfig.transportType}`);
    }

    // Initialize handshake
    const initResult = await this.transport.request<AcpInitializeResult>('initialize', {
      clientInfo: { name: 'claudian', version: '1.0.0' },
      capabilities: { chat: true, streaming: true, tools: true },
    });

    // Store agent info for capability detection
    this.activeAgentInfo = {
      id: agentConfig.id,
      name: agentConfig.name,
      serverInfo: initResult.serverInfo,
      capabilities: initResult.capabilities,
    };
  }

  private async shutdownTransport(): Promise<void> {
    if (this.transport) {
      this.transport.dispose();
      this.transport = null;
    }
    if (this.processManager) {
      await this.processManager.shutdown();
      this.processManager = null;
    }
    this.setReady(false);
  }

  private handleProcessExit(): void {
    this.setReady(false);
    this.rejectAllPending(new Error('ACP agent process exited'));
  }

  private rejectAllPending(_error: Error): void {
    if (this.chunkResolve) {
      this.chunkResolve();
      this.chunkResolve = null;
    }
  }

  private setReady(ready: boolean): void {
    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private resetTurnMetadata(): void {
    this.turnMetadata = {};
  }

  private recordTurnMetadata(update: Partial<ChatTurnMetadata>): void {
    this.turnMetadata = {
      ...this.turnMetadata,
      ...update,
    };
  }

  private buildAcpChatRequest(turn: PreparedChatTurn): AcpChatParams {
    // Build message history for context
    const messages: AcpMessage[] = [...this.conversationState.messageHistory];

    // Add current user message
    messages.push({ role: 'user', content: turn.prompt });

    return {
      messages,
      stream: true,
    };
  }

  private wireTransportHandlers(): void {
    if (!this.transport || !this.notificationRouter) return;

    const router = this.notificationRouter;
    const methods = [
      'chat/textDelta',
      'chat/toolUseStart',
      'chat/toolExecutionStarted',
      'chat/toolOutputDelta',
      'chat/toolExecutionCompleted',
      'chat/toolResult',
      'chat/messageStop',
      'chat/error',
    ];

    for (const method of methods) {
      this.transport.onNotification(method, (params) => {
        router.handleNotification(method, params);
      });
    }

    // Server requests (tool approval, user input)
    const requestMethods = [
      'tool/requestApproval',
      'user/requestInput',
    ];

    for (const method of requestMethods) {
      this.transport.onServerRequest(method, (requestId, params) => {
        return this.serverRequestRouter.handleServerRequest(requestId, method, params);
      });
    }
  }

  private dismissApprovalUI(): void {
    if (this.approvalDismisser) {
      this.approvalDismisser();
    }
  }

  private dismissAllPendingPrompts(): void {
    this.dismissApprovalUI();
    this.serverRequestRouter.abortPendingAskUser();
  }
}
