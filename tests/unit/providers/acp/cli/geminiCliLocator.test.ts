import { findGeminiBinaryPath, resolveGeminiCliPath } from '@/providers/acp/cli/GeminiCliLocator';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs.statSync globally
jest.mock('fs');
const mockStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('GeminiCliLocator', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('finds gemini binary in additional path on Unix', () => {
    const pathDir = '/test/bin';
    const pathBinary = '/test/bin/gemini';

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === pathBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    expect(findGeminiBinaryPath(pathDir, 'darwin')).toBe(pathBinary);
  });

  it('finds gemini.exe binary in additional path on Windows', () => {
    const pathDir = '/C/test/bin';
    const pathBinary = '/C/test/bin/gemini.exe';

    // Create the test file
    const fs = require('fs');
    const fsPath = require('path');
    fs.mkdirSync(fsPath.dirname(pathBinary), { recursive: true });
    fs.writeFileSync(pathBinary, '');

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === pathBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    expect(findGeminiBinaryPath(pathDir, 'win32')).toBe(pathBinary);
  });

  it('returns null when gemini not found', () => {
    mockStatSync.mockImplementation(() => { throw new Error('Not found'); });
    expect(findGeminiBinaryPath('/nonexistent/path', 'darwin')).toBeNull();
  });

  it('searches through multiple path entries', () => {
    const firstDir = '/first';
    const secondDir = '/second';
    const firstBinary = '/first/gemini';
    const secondBinary = '/second/gemini';

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === firstBinary || filePath === secondBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    const searchPath = `${firstDir}:${secondDir}`;
    expect(findGeminiBinaryPath(searchPath, 'linux')).toBe(firstBinary);
  });

  it('returns configured path if file exists', () => {
    const configuredBinary = '/configured/gemini';

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === configuredBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    expect(resolveGeminiCliPath(configuredBinary, '')).toBe(configuredBinary);
  });

  it('returns null if configured path does not exist', () => {
    mockStatSync.mockImplementation(() => { throw new Error('Not found'); });
    expect(resolveGeminiCliPath('/nonexistent/path/gemini', '')).toBeNull();
  });

  it('falls back to PATH search when no configured path', () => {
    const pathDir = '/test/bin';
    const pathBinary = '/test/bin/gemini';

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === pathBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    expect(resolveGeminiCliPath(undefined, `PATH=${pathDir}`)).toBe(pathBinary);
  });

  it('returns null when configured path is empty string', () => {
    mockStatSync.mockImplementation(() => { throw new Error('Not found'); });
    expect(resolveGeminiCliPath('', '')).toBeNull();
  });

  it('uses PATH from envText when provided and no configured path', () => {
    const envPath = '/env/bin';
    const envBinary = '/env/bin/gemini';

    mockStatSync.mockImplementation((filePath) => {
      if (filePath === envBinary) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('Not found');
    });

    const envText = `export PATH=${envPath}`;
    expect(resolveGeminiCliPath(undefined, envText)).toBe(envBinary);
  });
});