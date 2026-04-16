import { Setting, TextAreaComponent, TextComponent } from 'obsidian';
import type { ProviderSettingsTabRenderer, ProviderSettingsTabRendererContext } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { getAcpProviderSettings, setAcpProviderSettings, type AcpAgentConfig } from '../settings';

export const acpSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const acpSettings = getAcpProviderSettings(settingsBag);

    // --- Enable/Disable ---

    new Setting(container)
      .setName('Enable ACP provider')
      .setDesc('When enabled, ACP agents appear in the model selector for new conversations.')
      .addToggle((toggle) =>
        toggle
          .setValue(acpSettings.enabled)
          .onChange(async (value) => {
            setAcpProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    // --- Agent Configuration Section ---

    const agentsSection = container.createDiv({ cls: 'claudian-acp-agents-section' });
    new Setting(agentsSection).setName('ACP Agents').setHeading();

    const agentsList = agentsSection.createDiv({ cls: 'claudian-acp-agents-list' });
    renderAgentsList(agentsList, acpSettings.agents, settingsBag, context, acpSettings);

    // --- Add New Agent ---

    const addAgentSection = container.createDiv({ cls: 'claudian-acp-add-agent-section' });
    new Setting(addAgentSection).setName('Add new agent').setHeading();

    const newAgentForm = addAgentSection.createDiv({ cls: 'claudian-acp-new-agent-form' });
    newAgentForm.style.display = 'grid';
    newAgentForm.style.gap = '0.5em';
    newAgentForm.style.marginTop = '1em';

    // Agent ID
    const idRow = newAgentForm.createDiv();
    idRow.style.display = 'flex';
    idRow.style.gap = '0.5em';
    idRow.style.alignItems = 'center';
    idRow.createSpan({ text: 'ID:' });
    const idInput = new TextComponent(idRow);
    idInput.setPlaceholder('my-agent');
    idInput.inputEl.style.flex = '1';

    // Agent Name
    const nameRow = newAgentForm.createDiv();
    nameRow.style.display = 'flex';
    nameRow.style.gap = '0.5em';
    nameRow.style.alignItems = 'center';
    nameRow.createSpan({ text: 'Name:' });
    const nameInput = new TextComponent(nameRow);
    nameInput.setPlaceholder('My Agent');
    nameInput.inputEl.style.flex = '1';

    // Transport Type
    const transportRow = newAgentForm.createDiv();
    transportRow.style.display = 'flex';
    transportRow.style.gap = '0.5em';
    transportRow.style.alignItems = 'center';
    transportRow.createSpan({ text: 'Transport:' });
    const transportSelect = transportRow.createEl('select');
    transportSelect.createEl('option', { value: 'stdio', text: 'stdio' });
    transportSelect.createEl('option', { value: 'http', text: 'http' });
    transportSelect.createEl('option', { value: 'websocket', text: 'websocket' });

    // Command (for stdio)
    const commandRow = newAgentForm.createDiv({ cls: 'claudian-acp-stdio-row' });
    commandRow.style.display = 'flex';
    commandRow.style.gap = '0.5em';
    commandRow.style.alignItems = 'center';
    commandRow.createSpan({ text: 'Command:' });
    const commandInput = new TextComponent(commandRow);
    commandInput.setPlaceholder('/usr/local/bin/my-agent');
    commandInput.inputEl.style.flex = '1';

    // URL (for http/websocket)
    const urlRow = newAgentForm.createDiv({ cls: 'claudian-acp-url-row' });
    urlRow.style.display = 'none'; // Hidden by default
    urlRow.style.display = 'flex';
    urlRow.style.gap = '0.5em';
    urlRow.style.alignItems = 'center';
    urlRow.createSpan({ text: 'URL:' });
    const urlInput = new TextComponent(urlRow);
    urlInput.setPlaceholder('http://localhost:8080');
    urlInput.inputEl.style.flex = '1';

    // Headers (for http/websocket)
    const headersRow = newAgentForm.createDiv({ cls: 'claudian-acp-headers-row' });
    headersRow.style.display = 'none'; // Hidden by default
    headersRow.style.display = 'flex';
    headersRow.style.gap = '0.5em';
    headersRow.style.alignItems = 'center';
    headersRow.createSpan({ text: 'Headers (JSON):' });
    const headersInput = new TextComponent(headersRow);
    headersInput.setPlaceholder('{"Authorization": "Bearer token"}');
    headersInput.inputEl.style.flex = '1';

    // Show/hide fields based on transport type
    const updateFormVisibility = (): void => {
      const transport = transportSelect.value as AcpAgentConfig['transportType'];
      commandRow.style.display = transport === 'stdio' ? 'flex' : 'none';
      urlRow.style.display = (transport === 'http' || transport === 'websocket') ? 'flex' : 'none';
      headersRow.style.display = (transport === 'http' || transport === 'websocket') ? 'flex' : 'none';
    };

    transportSelect.onchange = updateFormVisibility;
    updateFormVisibility();

    // Add button
    const buttonRow = newAgentForm.createDiv();
    buttonRow.style.marginTop = '0.5em';
    const addButton = buttonRow.createEl('button', { text: 'Add Agent', cls: 'mod-cta' });

    // Clear form function
    const clearForm = (): void => {
      idInput.setValue('');
      nameInput.setValue('');
      commandInput.setValue('');
      urlInput.setValue('');
      headersInput.setValue('');
      transportSelect.value = 'stdio';
      updateFormVisibility();
    };

    addButton.onclick = async (): Promise<void> => {
      const id = idInput.getValue().trim();
      const name = nameInput.getValue().trim();
      const command = commandInput.getValue().trim();
      const url = urlInput.getValue().trim();
      const headersText = headersInput.getValue().trim();
      const transportType = transportSelect.value as AcpAgentConfig['transportType'];

      if (!id) {
        // TODO: show error
        return;
      }

      if (!name) {
        // TODO: show error
        return;
      }

      if (transportType === 'stdio' && !command) {
        // TODO: show error
        return;
      }

      if ((transportType === 'http' || transportType === 'websocket') && !url) {
        // TODO: show error
        return;
      }

      // Check for duplicate ID
      if (acpSettings.agents.some(a => a.id === id)) {
        // TODO: show error
        return;
      }

      const newAgent: AcpAgentConfig = {
        id,
        name,
        transportType,
        enabled: true,
      };

      if (transportType === 'stdio') {
        newAgent.command = command;
      }

      if (transportType === 'http' || transportType === 'websocket') {
        newAgent.url = url;
        if (headersText) {
          try {
            newAgent.headers = JSON.parse(headersText);
          } catch {
            // TODO: show error
            return;
          }
        }
      }

      setAcpProviderSettings(settingsBag, {
        agents: [...acpSettings.agents, newAgent],
      });

      await context.plugin.saveSettings();
      clearForm();
      renderAgentsList(agentsList, getAcpProviderSettings(settingsBag).agents, settingsBag, context, getAcpProviderSettings(settingsBag));
    };

    // --- Default Agent Selection ---

    const defaultSection = container.createDiv({ cls: 'claudian-acp-default-section' });
    new Setting(defaultSection)
      .setName('Default agent')
      .setDesc('Which agent to use by default when starting a new ACP conversation.')
      .addDropdown((dropdown) => {
        const enabledAgents = acpSettings.agents.filter(a => a.enabled);
        dropdown.addOption('', 'None');
        for (const agent of enabledAgents) {
          dropdown.addOption(agent.id, agent.name);
        }
        dropdown.setValue(acpSettings.defaultAgentId ?? '');
        dropdown.onChange(async (value) => {
          setAcpProviderSettings(settingsBag, {
            defaultAgentId: value || undefined,
          });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        });
      });
  },
};

function renderAgentsList(
  container: HTMLElement,
  agents: AcpAgentConfig[],
  settingsBag: Record<string, unknown>,
  context: ProviderSettingsTabRendererContext,
  acpSettings: ReturnType<typeof getAcpProviderSettings>,
): void {
  container.empty();

  if (agents.length === 0) {
    container.createEl('em', { text: 'No agents configured yet.' });
    return;
  }

  for (const agent of agents) {
    const agentEl = container.createDiv({ cls: 'claudian-acp-agent-item' });
    agentEl.style.display = 'flex';
    agentEl.style.justifyContent = 'space-between';
    agentEl.style.alignItems = 'center';
    agentEl.style.padding = '0.5em';
    agentEl.style.border = '1px solid var(--background-modifier-border)';
    agentEl.style.borderRadius = '4px';
    agentEl.style.marginBottom = '0.5em';

    const infoEl = agentEl.createDiv({ cls: 'claudian-acp-agent-info' });
    infoEl.createEl('strong', { text: agent.name });
    infoEl.createSpan({ text: ` (${agent.transportType})`, cls: 'claudian-acp-agent-transport' });
    infoEl.createEl('br');
    infoEl.createSpan({ text: `ID: ${agent.id}`, cls: 'claudian-acp-agent-id' });
    infoEl.style.fontSize = '0.9em';

    if (agent.transportType === 'stdio' && agent.command) {
      infoEl.createSpan({ text: `Command: ${agent.command}`, cls: 'claudian-acp-agent-command' });
      infoEl.createEl('br');
    }

    if ((agent.transportType === 'http' || agent.transportType === 'websocket') && agent.url) {
      infoEl.createSpan({ text: `URL: ${agent.url}`, cls: 'claudian-acp-agent-url' });
      infoEl.createEl('br');
    }

    const actionsEl = agentEl.createDiv({ cls: 'claudian-acp-agent-actions' });
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '0.5em';

    // Enable/Disable toggle
    const enabledToggle = actionsEl.createEl('input', { type: 'checkbox' });
    enabledToggle.checked = agent.enabled;
    enabledToggle.onclick = async (): Promise<void> => {
      const updatedAgents = acpSettings.agents.map(a =>
        a.id === agent.id ? { ...a, enabled: enabledToggle.checked } : a
      );
      setAcpProviderSettings(settingsBag, { agents: updatedAgents });
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    // Delete button
    const deleteButton = actionsEl.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    deleteButton.onclick = async (): Promise<void> => {
      const updatedAgents = acpSettings.agents.filter(a => a.id !== agent.id);
      let defaultAgentId = acpSettings.defaultAgentId;
      if (defaultAgentId === agent.id) {
        defaultAgentId = undefined;
      }
      setAcpProviderSettings(settingsBag, {
        agents: updatedAgents,
        defaultAgentId,
      });
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
      renderAgentsList(container, updatedAgents, settingsBag, context, getAcpProviderSettings(settingsBag));
    };
  }
}
