/** IDEA 风格翻译卡片的 HTML 渲染（供侧栏 Webview 使用） */
export interface CardSection {
  label: string;
  items: string[];
}

export interface CardPayload {
  word: string;
  phonetic?: string;
  translation: string;
  engine: string;
  to: string;
  sections: CardSection[];
  pinned: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把 "adj. 最初的" 拆成词性徽章 + 释义 */
function splitPos(meaning: string): { pos?: string; text: string } {
  const matched = /^([a-z]{1,5}\.)\s*(.+)$/i.exec(meaning);
  return matched ? { pos: matched[1], text: matched[2] } : { text: meaning };
}

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 10px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  .card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25));
    border-radius: 8px;
    padding: 12px 14px 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,.18);
  }
  .head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .word { font-size: 17px; font-weight: 600; letter-spacing: .2px; }
  .phonetic { font-family: var(--vscode-editor-font-family); font-size: 12.5px;
    color: var(--vscode-descriptionForeground); }
  .spacer { flex: 1; }
  button { font-family: inherit; cursor: pointer; }
  .icon-btn {
    background: transparent; border: none; color: var(--vscode-icon-foreground);
    padding: 2px 4px; border-radius: 4px; font-size: 14px;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18)); }
  .translation {
    margin: 8px 0 10px; padding: 8px 10px;
    font-size: 15px; line-height: 1.5;
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.1));
    border-left: 3px solid var(--vscode-textLink-foreground);
    border-radius: 4px;
    user-select: text;
  }
  .section { margin-top: 10px; }
  .label {
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-bottom: 4px;
  }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li { margin: 3px 0; line-height: 1.55; }
  .pos {
    display: inline-block; min-width: 30px; text-align: center;
    margin-right: 6px; padding: 0 5px;
    font-size: 10.5px; font-weight: 600; font-style: italic;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
    border-radius: 3px;
  }
  .inline { color: var(--vscode-foreground); line-height: 1.6; word-break: break-word; }
  blockquote {
    margin: 4px 0; padding: 2px 0 2px 9px;
    border-left: 2px solid var(--vscode-editorIndentGuide-background1, rgba(128,128,128,.35));
  }
  blockquote .en { display: block; }
  blockquote .zh { display: block; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .footer {
    margin-top: 12px; padding-top: 8px;
    border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.2));
  }
  .meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn {
    border: none; border-radius: 3px; padding: 5px 10px; font-size: 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn.primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); line-height: 1.8; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-cmd]');
    if (!target) return;
    vscode.postMessage({ command: target.dataset.cmd });
  });
`;

export function renderCardHtml(payload: CardPayload | undefined): string {
  if (!payload) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body><div class="card">
  <div class="word">翻译卡片</div>
  <p class="empty">把光标放到一个单词上，或选中一段文本，这里会显示释义与译文。</p>
  <p class="hint">对应 IDEA 的翻译弹框；也可以用 <code>Ctrl+Shift+Y</code> 单独翻译。</p>
</div></body></html>`;
  }

  const sections = payload.sections
    .filter((section) => section.items.length > 0)
    .map((section) => {
      if (section.label === '释义') {
        const items = section.items
          .map((item) => {
            const { pos, text } = splitPos(item);
            return `<li>${pos ? `<span class="pos">${escapeHtml(pos)}</span>` : ''}${escapeHtml(text)}</li>`;
          })
          .join('');
        return `<div class="section"><div class="label">释义</div><ul>${items}</ul></div>`;
      }
      if (section.label === '例句') {
        const items = section.items
          .map((item) => {
            const [en, zh] = item.split('\u0001');
            return `<blockquote><span class="en">${escapeHtml(en)}</span>${
              zh ? `<span class="zh">${escapeHtml(zh)}</span>` : ''
            }</blockquote>`;
          })
          .join('');
        return `<div class="section"><div class="label">例句</div>${items}</div>`;
      }
      if (section.label === '词形' || section.label === '柯林斯' || section.label === '英英') {
        return `<div class="section"><div class="label">${escapeHtml(section.label)}</div><div class="inline">${escapeHtml(
          section.items.join(' ｜ ')
        )}</div></div>`;
      }
      const items = section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      return `<div class="section"><div class="label">${escapeHtml(section.label)}</div><ul>${items}</ul></div>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body><div class="card">
  <div class="head">
    <span class="word">${escapeHtml(payload.word)}</span>
    ${payload.phonetic ? `<span class="phonetic">${escapeHtml(payload.phonetic)}</span>` : ''}
    <span class="spacer"></span>
    <button class="icon-btn" data-cmd="speak" title="朗读">🔊</button>
    <button class="icon-btn" data-cmd="pin" title="${payload.pinned ? '取消钉住' : '钉住（停止跟随光标）'}">${
    payload.pinned ? '📌' : '📍'
  }</button>
  </div>
  <div class="translation">${escapeHtml(payload.translation)}</div>
  ${sections}
  <div class="footer">
    <div class="meta">${escapeHtml(payload.engine)} · 译成${escapeHtml(payload.to)}</div>
    <div class="actions">
      <button class="btn primary" data-cmd="replace">替换原文</button>
      <button class="btn" data-cmd="copy">复制译文</button>
      <button class="btn" data-cmd="save">收藏</button>
      <button class="btn" data-cmd="detail">全部释义</button>
    </div>
  </div>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}
