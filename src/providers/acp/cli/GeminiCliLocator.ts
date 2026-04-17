import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath, parsePathEntries } from '../../../utils/path';

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveConfiguredPath(configuredPath: string | undefined): string | null {
  const trimmed = (configuredPath ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const expandedPath = expandHomePath(trimmed);
    return isExistingFile(expandedPath) ? expandedPath : null;
  } catch {
    return null;
  }
}

export function findGeminiBinaryPath(
  additionalPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  // Gemini CLI uses raw stdio spawn, so Windows shell shims are not viable targets here.
  const binaryNames = platform === 'win32'
    ? ['gemini.exe', 'gemini']
    : ['gemini'];
  const searchEntries = parsePathEntries(getEnhancedPath(additionalPath));

  for (const dir of searchEntries) {
    if (!dir) continue;

    for (const binaryName of binaryNames) {
      const candidate = path.join(dir, binaryName);
      if (isExistingFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function resolveGeminiCliPath(
  configuredPath: string | undefined,
  envText: string,
): string | null {
  const configured = resolveConfiguredPath(configuredPath);
  if (configured) {
    return configured;
  }

  const customEnv = parseEnvironmentVariables(envText || '');
  return findGeminiBinaryPath(customEnv.PATH);
}