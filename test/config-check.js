// 校验：代码里读取的配置项，是否都在 package.json 里声明过
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(
  Object.keys(pkg.contributes.configuration.properties).map((key) => key.replace(/^translation\./, ''))
);

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.ts')) {
      files.push(path.join(dir, entry.name));
    }
  }
})(path.join(root, 'src'));

const used = new Map();
const patterns = [/conf(?:<[^>]*>)?\(\s*'([^']+)'/g, /getConfig(?:<[^>]*>)?\(\s*'([^']+)'/g];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1];
      if (!used.has(key)) {
        used.set(key, path.basename(file));
      }
    }
  }
}

const missing = [...used.keys()].filter((key) => !declared.has(key));
const unused = [...declared].filter((key) => !used.has(key));

console.log(`代码读取的配置项: ${used.size}`);
console.log(`package.json 声明: ${declared.size}`);
console.log(`\n[缺失] 代码用了但没声明 (${missing.length}):`);
for (const key of missing) console.log(`  - ${key}  (${used.get(key)})`);
console.log(`\n[未使用] 声明了但代码没读 (${unused.length}):`);
for (const key of unused) console.log(`  - ${key}`);

// 命令一致性
const declaredCommands = new Set(pkg.contributes.commands.map((item) => item.command));
const registered = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /register\(\s*'(translation\.[^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) registered.add(m[1]);
}
const notRegistered = [...declaredCommands].filter((id) => !registered.has(id));
const notDeclared = [...registered].filter((id) => !declaredCommands.has(id));
console.log(`\n声明命令 ${declaredCommands.size} 个 / 实现 ${registered.size} 个`);
console.log(`  声明了但没实现: ${notRegistered.join(', ') || '无'}`);
console.log(`  实现了但没声明: ${notDeclared.join(', ') || '无'}`);

// 键位/菜单里引用的命令必须存在
const refs = [];
for (const kb of pkg.contributes.keybindings ?? []) refs.push(['keybinding', kb.command]);
for (const [menu, items] of Object.entries(pkg.contributes.menus ?? {})) {
  for (const item of items) refs.push([menu, item.command]);
}
const badRefs = refs.filter(([, id]) => !declaredCommands.has(id));
console.log(`\n键位/菜单引用失效: ${badRefs.length ? badRefs.map(([a, b]) => `${a}:${b}`).join(', ') : '无'}`);
