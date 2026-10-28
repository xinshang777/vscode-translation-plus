import * as vscode from 'vscode';

export const CONFIG_SECTION = 'translation';

export function conf<T>(key: string, defaultValue: T): T {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key);
  return value === undefined || value === null ? defaultValue : value;
}

/** 优先从安全存储取密钥，其次读配置项。 */
export async function secretOrSetting(
  context: vscode.ExtensionContext,
  secretKey: string,
  settingKey: string
): Promise<string | undefined> {
  const stored = await context.secrets.get(secretKey);
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromConfig = conf<string>(settingKey, '').trim();
  return fromConfig.length > 0 ? fromConfig : undefined;
}

export async function promptSecret(
  context: vscode.ExtensionContext,
  secretKey: string,
  label: string
): Promise<boolean> {
  const value = await vscode.window.showInputBox({
    title: `设置 ${label}`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: '粘贴 API Key 后回车（保存在 VSCode 安全存储中，不写入 settings.json）'
  });
  if (value === undefined) {
    return false;
  }
  if (value.trim().length === 0) {
    await context.secrets.delete(secretKey);
    void vscode.window.showInformationMessage(`已清除 ${label}`);
    return true;
  }
  await context.secrets.store(secretKey, value.trim());
  void vscode.window.showInformationMessage(`已保存 ${label}`);
  return true;
}
