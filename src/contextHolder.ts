import type * as vscode from 'vscode';

let current: vscode.ExtensionContext | undefined;

export function setExtensionContext(context: vscode.ExtensionContext): void {
  current = context;
}

export function getExtensionContext(): vscode.ExtensionContext | undefined {
  return current;
}
