// 对照 ReplaceWithTranslationAction.kt 的行为做单元验证
const {
  getWordsIn,
  splitCamelCaseWords,
  fixWhitespace,
  createReplaceElements
} = require('../out/replace');

const cases = [
  ['getUserName', ['get', 'User', 'Name']],
  ['user_name', ['user', 'name']],
  ['HTTPServer2Port', ['HTTP', 'Server', '2', 'Port']],
  ['upload file', ['upload', 'file']]
];
for (const [input, expected] of cases) {
  const actual = getWordsIn(input);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✅' : '❌'} getWordsIn(${input}) = ${JSON.stringify(actual)}`);
}

console.log('\nsplitCamelCaseWords:');
for (const input of ['getUserName', 'uploadFileToServer', 'const value = getUserId;', '多行\ntext with\nnewline']) {
  console.log(`  ${JSON.stringify(input)} → ${JSON.stringify(splitCamelCaseWords(input))}`);
}

console.log('\nfixWhitespace:', JSON.stringify(fixWhitespace('a\u00a0b\u3000c')));

console.log('\ncreateReplaceElements("Upload file", target=EN):');
for (const item of createReplaceElements('Upload file', [], true, false, '_ -')) {
  console.log('  -', JSON.stringify(item));
}

console.log('\ncreateReplaceElements("Upload file", target=ZH):');
for (const item of createReplaceElements('上传文件', [], false, false, '_ -')) {
  console.log('  -', JSON.stringify(item));
}

console.log('\ncreateReplaceElements 纯文本（不生成命名形式）:');
console.log('  ', createReplaceElements('Upload file', [], true, true, '_ -'));

console.log('\n超长词条（>50 字符）不生成命名形式:');
const long = 'This is a very long sentence that exceeds fifty characters in total length';
console.log('  ', createReplaceElements(long, [], true, false, '_ -').length, '个候选');
