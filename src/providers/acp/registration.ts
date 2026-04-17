import type { ProviderRegistration } from '../../core/providers/types';
import { AcpInlineEditService } from './auxiliary/AcpInlineEditService';
import { AcpInstructionRefineService } from './auxiliary/AcpInstructionRefineService';
import { AcpTaskResultInterpreter } from './auxiliary/AcpTaskResultInterpreter';
import { AcpTitleGenerationService } from './auxiliary/AcpTitleGenerationService';
import { ACP_PROVIDER_CAPABILITIES } from './capabilities';
import { acpSettingsReconciler } from './env/AcpSettingsReconciler';
import { AcpConversationHistoryService } from './history/AcpConversationHistoryService';
import { AcpChatRuntime } from './runtime/AcpChatRuntime';
import { getAcpProviderSettings } from './settings';
import { acpChatUIConfig } from './ui/AcpChatUIConfig';

export const acpProviderRegistration: ProviderRegistration = {
  displayName: 'ACP',
  blankTabOrder: 30,
  isEnabled: (settings) => getAcpProviderSettings(settings).enabled,
  capabilities: ACP_PROVIDER_CAPABILITIES,
  environmentKeyPatterns: [/^ACP_/i, /^GEMINI_/i],
  chatUIConfig: acpChatUIConfig,
  settingsReconciler: acpSettingsReconciler,
  createRuntime: ({ plugin }) => new AcpChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new AcpTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new AcpInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new AcpInlineEditService(plugin),
  historyService: new AcpConversationHistoryService(),
  taskResultInterpreter: new AcpTaskResultInterpreter(),
};
