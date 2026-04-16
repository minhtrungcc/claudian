import type { ProviderWorkspaceRegistration } from '../../../core/providers/types';
import { acpSettingsTabRenderer } from '../ui/AcpSettingsTab';

export const acpWorkspaceRegistration: ProviderWorkspaceRegistration = {
  async initialize(_context) {
    // ACP doesn't have workspace services in MVP
    return {
      settingsTabRenderer: acpSettingsTabRenderer,
    };
  },
};
