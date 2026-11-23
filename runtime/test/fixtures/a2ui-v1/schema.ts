import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const fixture = (file: string) => Bun.file(new URL(file, import.meta.url));
const base = 'https://a2ui.org/specification/v1_0/';
const files = ['agent_to_renderer', 'renderer_to_agent', 'common_types', 'agent_capabilities', 'renderer_capabilities', 'renderer_data_model', 'catalog_definition'];

export async function referenceValidator(catalogue = 'basic-catalog.json') {
  const validator = new Ajv2020({strict: false}); // Upstream schemas have descriptive catalogue keywords.
  addFormats(validator);
  for (const file of files) validator.addSchema(await fixture(`${file}.json`).json());
  // Use the same alias as the upstream conformance runner. Never fetch $refs.
  validator.addSchema({...await fixture(catalogue).json(), $id: `${base}catalog.json`});
  return (schema: string) => {
    const validate = validator.getSchema(`${base}${schema}`);
    if (!validate) throw Error(`Missing reference schema ${schema}`);
    return validate;
  };
}
