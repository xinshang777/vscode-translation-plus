const { ENGINES } = require('../out/engines');
const { MissingCredentialError } = require('../out/engines/types');
const { aliyunSignature } = require('../out/engines/aliyun');
const { volcSignature } = require('../out/engines/volcengine');

const ctx = { getConfig: (k, d) => d, getSecret: async () => undefined, timeout: 5000 };

(async () => {
  console.log('engines:', Object.keys(ENGINES).join(','));
  for (const id of ['baidu', 'tencent', 'aliyun', 'volcengine', 'caiyun']) {
    try {
      await ENGINES[id].translate('hello', 'auto', 'zh', ctx);
      console.log(id, 'unexpected success');
    } catch (error) {
      console.log(id, error instanceof MissingCredentialError ? 'MissingCredentialError ✓' : `other: ${error.message}`);
    }
  }

  const ali = aliyunSignature(
    {
      Action: 'TranslateGeneral',
      Version: '2018-10-12',
      Format: 'JSON',
      AccessKeyId: 'testid',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: 'abc',
      Timestamp: '2024-01-01T00:00:00Z',
      RegionId: 'cn-hangzhou',
      SourceLanguage: 'en',
      TargetLanguage: 'zh',
      SourceText: 'hello'
    },
    'secret'
  );
  console.log('aliyun sig:', ali);

  const vol = volcSignature({
    accessKeyId: 'AK',
    secretKey: 'SK',
    xDate: '20240101T000000Z',
    body: '{"a":1}',
    contentType: 'application/json',
    query: 'Action=TranslateText&Version=2020-06-01'
  });
  console.log('volc auth len:', vol.authorization.length, '|', vol.authorization.slice(0, 60));

  const { iso2 } = require('../out/languages');
  console.log('iso2 map:', ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'vi'].map((id) => `${id}=>${iso2(id)}`).join(' '));
})();
