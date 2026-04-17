import type { AcpAgentConfig } from '../settings';

export type BuiltinAgentType = 'gemini-cli' | 'gemini-cli-wsl';

export const BUILTIN_AGENT_TYPES: Readonly<BuiltinAgentType[]> = Object.freeze([
  'gemini-cli',
  'gemini-cli-wsl',
] as const);

interface BuiltinAgentFactory {
  create: (customPath?: string) => Omit<AcpAgentConfig, 'id'>;
}

const BUILTIN_AGENTS: Readonly<Record<BuiltinAgentType, BuiltinAgentFactory>> = Object.freeze({
  'gemini-cli': {
    create: (customPath) => ({
      name: 'Gemini CLI',
      transportType: 'stdio',
      command: customPath ?? 'gemini',
      args: ['app-server'],
      enabled: true,
    }),
  },
  'gemini-cli-wsl': {
    create: (customPath) => ({
      name: 'Gemini CLI (WSL)',
      transportType: 'stdio',
      command: customPath ?? 'gemini',
      args: ['app-server'],
      env: { GEMINI_USE_WSL: '1' },
      enabled: true,
    }),
  },
});

export function listBuiltinAgentTypes(): Readonly<BuiltinAgentType[]> {
  return BUILTIN_AGENT_TYPES;
}

export function getBuiltinAgentConfig(
  type: BuiltinAgentType,
  customPath?: string,
): AcpAgentConfig {
  const factory = BUILTIN_AGENTS[type];
  if (!factory) {
    throw new Error(`Unknown built-in agent type: ${type}`);
  }

  return {
    id: type,
    ...factory.create(customPath),
  };
}

export function isBuiltinAgentType(value: string): value is BuiltinAgentType {
  return BUILTIN_AGENT_TYPES.includes(value as BuiltinAgentType);
}