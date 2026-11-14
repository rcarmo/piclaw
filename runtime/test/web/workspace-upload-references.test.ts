import { expect, test } from 'bun:test';
import { isSafeUploadFilename } from '../../src/core/upload-limits';

test('large upload names cannot spoof line-oriented references and remain portable', () => {
  for(const name of ['large file.bin','résumé.pdf','image.png'])expect(isSafeUploadFilename(name)).toBe(true);
  for(const name of ['../a','x\\y',' leading','trailing ','trailing.','CON','nul.txt','a\nb','a\u2028b','a\u202eb','x:stream','x'.repeat(221)])expect(isSafeUploadFilename(name)).toBe(false);
});
