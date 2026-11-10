import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveProviderModelPricing } from '../../../runtime/skills/operator/token-chart/provider-model-pricing-reference.ts';

const dir = import.meta.dir;
const manifest = await Bun.file(`${dir}/sources/manifest.json`).json();
const captures = new Map<string, Uint8Array>();
for (const source of manifest) {
  assert.equal(source.status, 200);
  const stored = await Bun.file(`${dir}/sources/${source.file}`).bytes();
  const bytes = source.encoding === 'gzip' ? Bun.gunzipSync(stored) : stored;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, source.file);
  captures.set(source.file.replace(/\.gz$/, ''), bytes);
}
const text = (name: string) => new TextDecoder().decode(captures.get(name)!);
const pricing = text('pricing.md');
for (const name of ['Claude Fable 5.2', 'Claude Mythos 5.2']) {
  const row = pricing.split('\n').find(line => line.startsWith(`| ${name} `));
  assert(row, name);
  const amounts = row.split('|').slice(2, -1).map(cell => Number(cell.match(/\$([\d.]+)/)![1]));
  assert.deepEqual(amounts, [8, 10, 16, 0.2, 40]);
  assert(pricing.split('\n').some(line => line.startsWith(`| ${name} `) && /\$16 USD/.test(line) && /\$80 USD/.test(line)));
}
assert(pricing.includes('Batch API and prompt caching discounts can be combined'));
assert(pricing.includes('1.1x multiplier on all token pricing categories'));
assert(pricing.includes('full [1M token context window]'));

const data = await Bun.file(`${dir}/complete-pricing.json`).json();
assert.equal(data.nativeRecords.length, 12);
const base = { input: 8, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16, output: 40 };
for (const row of data.nativeRecords) {
  assert(['claude-fable-5-2', 'claude-mythos-5-2'].includes(row.model));
  assert(['standard', 'batch', 'fast'].includes(row.tier));
  assert(['global', 'us-only'].includes(row.geography));
  const multiplier = (row.tier === 'batch' ? 0.5 : row.tier === 'fast' ? 2 : 1) * (row.geography === 'us-only' ? 1.1 : 1);
  for (const [field, price] of Object.entries(base)) assert(Math.abs(row.rates[field] - price * multiplier) < 1e-10);
  assert.equal(row.longContextPremium, false);
}
assert.equal(new Set(data.nativeRecords.map(row => `${row.model}/${row.tier}/${row.geography}`)).size, 12);

const awsSources = manifest.filter(source => source.file.startsWith('aws/'));
assert.equal(awsSources.length, 35);
let awsRows = 0;
for (const source of awsSources) {
  const catalogue = JSON.parse(text(source.file.replace(/\.gz$/, '')));
  const region = source.file.slice(4).replace(/\.json\.gz$/, '');
  for (const product of Object.values(catalogue.products) as any[]) {
    if (!/^Claude (Fable|Mythos) 5\.2$/.test(product.attributes.model)) continue;
    for (const term of Object.values(catalogue.terms.OnDemand[product.sku] ?? {}) as any[]) {
      for (const dimension of Object.values(term.priceDimensions) as any[]) {
        const type = product.attributes.usagetype;
        const field = type.includes('cache_read') ? 'cacheRead' : type.includes('cache_write_tokens_1h') ? 'cacheWrite1h' : type.includes('cache_write') ? 'cacheWrite5m' : type.includes('output') ? 'output' : 'input';
        const multiplier = type.includes('_global_') ? 1 : region.startsWith('us-gov-') ? 1.2 : 1.1;
        assert.equal(dimension.unit, '1M tokens');
        const price = Number(dimension.pricePerUnit.USD);
        assert(Math.abs(price - base[field] * multiplier) < 1e-10);
        const matching = data.aws.regionalRows.filter(row => row.region === region && row.model === product.attributes.model && row.usageType === type);
        assert.equal(matching.length, 1);
        assert.equal(matching[0].priceUSD, price);
        assert.equal(matching[0].description, dimension.description);
        assert.equal(matching[0].effectiveDate, term.effectiveDate);
        awsRows++;
      }
    }
  }
}
assert.equal(awsRows, 490);
assert.equal(data.aws.regionalRows.length, awsRows);

const runtime = await Bun.file(`${dir}/../../../runtime/skills/operator/token-chart/pricing-2026-11-09.json`).json();
assert.equal(runtime.length, 4);
for (const row of runtime) {
  assert.equal(row.provider, 'anthropic');
  const upstream = row.model.replace('-5.2', '-5-2').replace(/-fast$/, '');
  const full = data.nativeRecords.find(rate => rate.model === upstream && rate.geography === 'global' && rate.tier === (row.model.endsWith('-fast') ? 'fast' : 'standard'));
  assert(full);
  assert.deepEqual([row.inputPerMTok, row.outputPerMTok, row.cacheReadPerMTok, row.cacheWritePerMTok], [full.rates.input, full.rates.output, full.rates.cacheRead, full.rates.cacheWrite5m]);
  assert.equal(resolveProviderModelPricing(row.provider, row.model).inputPerMTok, row.inputPerMTok);
}
assert(!/Fable 5\.2|Mythos 5\.2/.test(text('copilot.md')));
assert(!JSON.parse(text('openrouter.json')).data.some(model => /claude-(fable|mythos)-5[.-]2/.test(model.id)));
const csvRows = (name: string) => Bun.file(`${dir}/${name}`).text().then(value => value.trim().split('\n').slice(1).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'))));
const nativeCsv = await csvRows('native-rates.csv');
assert.equal(nativeCsv.length, 12);
for (const cells of nativeCsv) {
  const row = data.nativeRecords.find(rate => rate.model === cells[1] && rate.tier === cells[2] && rate.geography === cells[3]);
  assert(row);
  assert.deepEqual(cells.slice(5, 10).map(Number), [row.rates.input, row.rates.cacheRead, row.rates.cacheWrite5m, row.rates.cacheWrite1h, row.rates.output]);
}
const awsCsv = await csvRows('aws-regional-rates.csv');
assert.equal(awsCsv.length, awsRows);
for (const cells of awsCsv) {
  const row = data.aws.regionalRows.find(rate => rate.region === cells[0] && rate.model === cells[1] && rate.usageType === cells[2]);
  assert(row);
  assert.equal(Number(cells[4]), row.priceUSD);
}
assert(text('api-credit-benefit.md').includes('New subscribers can claim credits after 7 days'));
console.log(JSON.stringify({ status: 'PASS', sourceHashes: manifest.length, nativeRateCards: data.nativeRecords.length, awsRegions: awsSources.length, awsPriceRows: awsRows, estimatorRows: runtime.length, networkUsed: false }));
