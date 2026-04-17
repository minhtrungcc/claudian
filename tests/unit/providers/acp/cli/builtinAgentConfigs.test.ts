import { isBuiltinAgent, getAgentBuiltinType, getBuiltinAgentConfig, listBuiltinAgentTypes } from '@/providers/acp/cli/builtinAgentConfigs';
import type { AcpAgentConfig } from '@/providers/acp/settings';

describe('builtinAgentConfigs', () => {
  describe('listBuiltinAgentTypes', () => {
    it('returns list of built-in agent types', () => {
      const types = listBuiltinAgentTypes();
      expect(types).toContain('gemini-cli');
      expect(types).toContain('gemini-cli-wsl');
    });

    it('returns read-only array', () => {
      const types = listBuiltinAgentTypes();
      expect(() => {
        (types as string[]).push('new-type');
      }).toThrow();
    });
  });

  describe('getBuiltinAgentConfig', () => {
    it('returns gemini-cli config with default command', () => {
      const config = getBuiltinAgentConfig('gemini-cli');
      expect(config).toMatchObject({
        id: 'gemini-cli',
        name: 'Gemini CLI',
        transportType: 'stdio',
        enabled: true,
        command: 'gemini',
      });
    });

    it('returns gemini-cli-wsl config for WSL', () => {
      const config = getBuiltinAgentConfig('gemini-cli-wsl');
      expect(config).toMatchObject({
        id: 'gemini-cli-wsl',
        name: 'Gemini CLI (WSL)',
        transportType: 'stdio',
        enabled: true,
        command: 'gemini',
      });
      expect(config.args).toContain('app-server');
    });

    it('returns gemini-cli config with custom path when provided', () => {
      const config = getBuiltinAgentConfig('gemini-cli', '/custom/path/to/gemini');
      expect(config.command).toBe('/custom/path/to/gemini');
    });

    it('throws error for unknown agent type', () => {
      expect(() => getBuiltinAgentConfig('unknown' as any))
        .toThrow('Unknown built-in agent type: unknown');
    });

    it('returns valid AcpAgentConfig shape', () => {
      const config = getBuiltinAgentConfig('gemini-cli');
      const agentConfig: AcpAgentConfig = config;
      expect(typeof agentConfig.id).toBe('string');
      expect(typeof agentConfig.name).toBe('string');
      expect(['stdio', 'http', 'websocket']).toContain(agentConfig.transportType);
      expect(typeof agentConfig.enabled).toBe('boolean');
    });

    it('returns valid AcpAgentConfig shape', () => {
      const config = getBuiltinAgentConfig('gemini-cli');
      const agentConfig: AcpAgentConfig = config;
      expect(typeof agentConfig.id).toBe('string');
      expect(typeof agentConfig.name).toBe('string');
      expect(['stdio', 'http', 'websocket']).toContain(agentConfig.transportType);
      expect(typeof agentConfig.enabled).toBe('boolean');
    });
  });
});

describe('isBuiltinAgent', () => {
  it('returns true for built-in agent with builtinType', () => {
    const config = getBuiltinAgentConfig('gemini-cli');
    expect(isBuiltinAgent(config)).toBe(true);
  });

  it('returns false for agent without builtinType', () => {
    const manualAgent: AcpAgentConfig = {
      id: 'manual',
      name: 'Manual Agent',
      transportType: 'stdio',
      command: 'custom',
      enabled: true,
    };
    expect(isBuiltinAgent(manualAgent)).toBe(false);
  });

  it('returns false for empty string builtinType', () => {
    const config = getBuiltinAgentConfig('gemini-cli');
    config.builtinType = '';
    expect(isBuiltinAgent(config)).toBe(false);
  });
});

describe('getAgentBuiltinType', () => {
  it('returns builtinType for built-in agents', () => {
    const config = getBuiltinAgentConfig('gemini-cli');
    expect(getAgentBuiltinType(config)).toBe('gemini-cli');
  });

  it('returns null for agents without builtinType', () => {
    const manualAgent: AcpAgentConfig = {
      id: 'manual',
      name: 'Manual Agent',
      transportType: 'stdio',
      command: 'custom',
      enabled: true,
    };
    expect(getAgentBuiltinType(manualAgent)).toBeNull();
  });
});