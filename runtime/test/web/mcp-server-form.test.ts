import { expect, test } from 'bun:test';
import { MCP_SERVER_FIELDS, patchFromForm } from '../../web/src/ui/mcp-server-settings-model.js';
import { MCP_FIELD_CHOICES, MCP_FIELD_HELP, MCP_FORM_FIELDS } from '../../web/src/ui/mcp-server-form.js';

test('the redesigned form retains every existing field and explicit null removal', () => {
    expect([...MCP_FORM_FIELDS.keys()]).toEqual(MCP_SERVER_FIELDS.map(([field]) => field));
    for (const [field] of MCP_SERVER_FIELDS) {
        expect(MCP_FIELD_HELP[field].length).toBeGreaterThan(0);
        expect(patchFromForm({ [field]: '' })).toEqual({});
        expect(patchFromForm({ [field]: 'null' })).toEqual({ [field]: null });
    }
});
test('friendly selections round-trip through the unchanged patch parser', () => {
    for (const [field, options] of Object.entries(MCP_FIELD_CHOICES)) {
        const kind = MCP_FORM_FIELDS.get(field as typeof MCP_SERVER_FIELDS[number][0])![2];
        for (const [value] of options) expect(patchFromForm({ [field]: value })).toEqual({ [field]: kind === 'json' ? JSON.parse(value) : value });
    }
    expect(patchFromForm({ url: 'https://tools.example.test/mcp', auth: '"bearer"', bearerTokenKeychain: 'services/reader', bearerTokenEnv: 'SERVICE_TOKEN', directTools: 'false', lifecycle: 'lazy' })).toEqual({ url: 'https://tools.example.test/mcp', auth: 'bearer', bearerTokenKeychain: 'services/reader', bearerTokenEnv: 'SERVICE_TOKEN', directTools: false, lifecycle: 'lazy' });
});
