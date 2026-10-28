import { spawn, type ChildProcess } from 'child_process';

let current: ChildProcess | undefined;

const WINDOWS_SCRIPT = [
  '$ErrorActionPreference="Stop"',
  '$text=[Console]::In.ReadToEnd()',
  'if (-not $text) { exit 0 }',
  'Add-Type -AssemblyName System.Speech',
  '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'if ($env:TRANSLATION_TTS_RATE) { $synth.Rate = [int]$env:TRANSLATION_TTS_RATE }',
  '$synth.Speak($text)'
].join('; ');

function escapePowerShellSingle(text: string): string {
  return text.replace(/'/g, "''");
}

/** 用系统自带 TTS 朗读，不依赖网络。 */
export function speak(text: string, onExit?: () => void): void {
  const value = text.trim();
  if (!value) {
    onExit?.();
    return;
  }
  stopSpeaking();
  try {
    if (process.platform === 'win32') {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }
      );
      child.stdin?.end(value, 'utf8');
      current = child;
    } else if (process.platform === 'darwin') {
      const child = spawn('say', ['-r', '180', value], { stdio: 'ignore' });
      current = child;
    } else {
      const child = spawn('spd-say', ['-w', value], { stdio: 'ignore' });
      child.on('error', () => {
        const fallback = spawn('espeak-ng', [value], { stdio: 'ignore' });
        fallback.on('error', () => undefined);
        current = fallback;
      });
      current = child;
    }
    current.once('exit', () => {
      current = undefined;
      onExit?.();
    });
    current.once('error', () => {
      current = undefined;
      onExit?.();
    });
  } catch {
    /* 朗读失败不影响主流程 */
  }
}

export function stopSpeaking(): void {
  if (current && !current.killed) {
    try {
      current.kill();
    } catch {
      /* ignore */
    }
  }
  current = undefined;
}

export function escapeForShell(text: string): string {
  return escapePowerShellSingle(text);
}
