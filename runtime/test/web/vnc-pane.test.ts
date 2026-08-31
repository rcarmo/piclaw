import { afterEach, expect, test } from 'bun:test';

import {
  buildDirectVncTargetReference,
  buildVncTabPath,
  CDP_BROWSER_VNC_TAB_PATH,
  clearVncPagePassword,
  consumeVncPopoutPassword,
  createVncPopoutTransferPayload,
  DEFAULT_DIRECT_VNC_TARGET,
  getVncPagePassword,
  getVncTargetsEmptyStateCopy,
  isVncCursorRectAllowed,
  isVncFramebufferSizeAllowed,
  loadVncDirectTarget,
  normalizeDirectVncHost,
  parseVncTargetFromPath,
  prepareDirectVncSelection,
  relocateVncPaneRoot,
  shouldOpenVncTargetDirectly,
  shouldRetryVncPopoutWithoutHandoff,
  stashVncPopoutPassword,
  VNC_DIRECT_TARGET_STORAGE_KEY,
} from '../../web/src/panes/vnc-pane.js';

test('buildVncTabPath encodes target ids when present', () => {
  expect(buildVncTabPath()).toBe('piclaw://vnc');
  expect(buildVncTabPath('host:5901')).toBe('piclaw://vnc/host%3A5901');
  expect(buildVncTabPath('cdp-browser')).toBe(CDP_BROWSER_VNC_TAB_PATH);
  expect(CDP_BROWSER_VNC_TAB_PATH).toBe('piclaw://vnc/cdp-browser');
  expect(parseVncTargetFromPath(CDP_BROWSER_VNC_TAB_PATH)).toBe('cdp-browser');
  expect(parseVncTargetFromPath('piclaw://vnc')).toBeNull();
  expect(shouldOpenVncTargetDirectly(CDP_BROWSER_VNC_TAB_PATH)).toBe(true);
  expect(shouldOpenVncTargetDirectly('piclaw://vnc')).toBe(false);
});

test('direct VNC target formatting preserves defaults, host formats, and integer port validation', () => {
  expect(DEFAULT_DIRECT_VNC_TARGET).toEqual({ host: 'localhost', port: '5901' });
  expect(normalizeDirectVncHost('')).toBe('localhost');
  expect(normalizeDirectVncHost(' lab-host ')).toBe('lab-host');
  expect(buildDirectVncTargetReference('', 5901)).toBe('localhost:5901');
  expect(buildDirectVncTargetReference('lab-host', '5902')).toBe('lab-host:5902');
  expect(buildDirectVncTargetReference('192.168.1.10', 5903)).toBe('192.168.1.10:5903');
  expect(buildDirectVncTargetReference('2001:db8::1', 5904)).toBe('[2001:db8::1]:5904');
  expect(buildDirectVncTargetReference('[2001:db8::1]', 5904)).toBe('[2001:db8::1]:5904');
  expect(buildDirectVncTargetReference('lab-host', 0)).toBeNull();
  expect(buildDirectVncTargetReference('lab-host', 65536)).toBeNull();
  expect(buildDirectVncTargetReference('lab-host', 5901.5)).toBeNull();
  expect(buildDirectVncTargetReference('lab-host', 'invalid')).toBeNull();
});

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => map.has(key) ? map.get(key)! : null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      get length() { return map.size; },
    },
    map,
  };
}

afterEach(() => clearVncPagePassword());

test('untouched direct VNC defaults select localhost:5901 without a password', () => {
  const memory = createMemoryStorage();
  const runtime = { localStorage: memory.storage } as any;

  expect(loadVncDirectTarget(runtime)).toEqual(DEFAULT_DIRECT_VNC_TARGET);
  expect(prepareDirectVncSelection('localhost', '5901', '', runtime)).toEqual({
    targetRef: 'localhost:5901',
    password: null,
  });
  expect(getVncPagePassword()).toBeNull();
  expect(memory.map.get(VNC_DIRECT_TARGET_STORAGE_KEY)).toBe(JSON.stringify({ host: 'localhost', port: '5901' }));
  expect(createVncPopoutTransferPayload('localhost:5901', getVncPagePassword(), runtime)).toEqual({
    pane_path: 'piclaw://vnc/localhost%3A5901',
  });
  expect(Array.from(memory.map.keys())).toEqual([VNC_DIRECT_TARGET_STORAGE_KEY]);
});

test('direct VNC selection persists only validated host and port and keeps its password in page memory', () => {
  const memory = createMemoryStorage();
  const runtime = { localStorage: memory.storage } as any;

  expect(prepareDirectVncSelection(' lab-host ', '5902', 'secret-long', runtime)).toEqual({
    targetRef: 'lab-host:5902',
    password: 'secret-l',
  });
  expect(loadVncDirectTarget(runtime)).toEqual({ host: 'lab-host', port: '5902' });
  expect(getVncPagePassword()).toBe('secret-l');
  expect(memory.map.get(VNC_DIRECT_TARGET_STORAGE_KEY)).toBe(JSON.stringify({ host: 'lab-host', port: '5902' }));
  expect(Array.from(memory.map.values()).join('\n')).not.toContain('secret');

  clearVncPagePassword();
  expect(loadVncDirectTarget(runtime)).toEqual({ host: 'lab-host', port: '5902' });
  expect(getVncPagePassword()).toBeNull();
});

test('clearing a direct VNC password forgets the older page-lifetime credential', () => {
  const memory = createMemoryStorage();
  const runtime = { localStorage: memory.storage } as any;

  expect(prepareDirectVncSelection('lab-host', '5902', 'secret', runtime)?.password).toBe('secret');
  expect(prepareDirectVncSelection('lab-host', '5902', '', runtime)?.password).toBeNull();
  expect(getVncPagePassword()).toBeNull();
});

test('direct VNC storage failures and malformed settings fall back without blocking selection', () => {
  const malformed = createMemoryStorage();
  malformed.map.set(VNC_DIRECT_TARGET_STORAGE_KEY, '{bad json');
  expect(loadVncDirectTarget({ localStorage: malformed.storage } as any)).toEqual(DEFAULT_DIRECT_VNC_TARGET);
  malformed.map.set(VNC_DIRECT_TARGET_STORAGE_KEY, JSON.stringify({ host: 'lab-host', port: 70000 }));
  expect(loadVncDirectTarget({ localStorage: malformed.storage } as any)).toEqual(DEFAULT_DIRECT_VNC_TARGET);

  const unavailable = Object.defineProperty({}, 'localStorage', {
    get() { throw new Error('storage disabled'); },
  });
  expect(loadVncDirectTarget(unavailable as any)).toEqual(DEFAULT_DIRECT_VNC_TARGET);
  expect(prepareDirectVncSelection('lab-host', '5902', 'secret', unavailable as any)).toEqual({
    targetRef: 'lab-host:5902',
    password: 'secret',
  });

  const writeFailure = {
    localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: () => {},
    },
  };
  expect(prepareDirectVncSelection('lab-host', '5902', '', writeFailure as any)?.targetRef).toBe('lab-host:5902');
  expect(prepareDirectVncSelection('lab-host', '5901.5', '', writeFailure as any)).toBeNull();
});

test('createVncPopoutTransferPayload serializes target identity and optional password token', () => {
  const memory = createMemoryStorage();
  const runtime = { localStorage: memory.storage } as any;

  expect(createVncPopoutTransferPayload(undefined, undefined, runtime)).toBeNull();
  expect(createVncPopoutTransferPayload('lab', null, runtime)).toEqual({ pane_path: 'piclaw://vnc/lab' });

  const payload = createVncPopoutTransferPayload('lab', 'secret', runtime);
  expect(payload?.pane_path).toBe('piclaw://vnc/lab');
  expect(typeof payload?.vnc_secret).toBe('string');
  expect(payload?.vnc_secret).toBeTruthy();
});

 test('stashVncPopoutPassword stores a one-time password token', () => {
  const memory = createMemoryStorage();
  const runtime = { localStorage: memory.storage } as any;
  const token = stashVncPopoutPassword('secret-long', runtime, 1000);
  expect(typeof token).toBe('string');
  expect(consumeVncPopoutPassword(token, runtime, 1001)).toBe('secret-l');
  expect(consumeVncPopoutPassword(token, runtime, 1002)).toBeNull();
});

test('VNC display bounds reject oversized framebuffers and cursor images', () => {
  expect(isVncFramebufferSizeAllowed(8192, 2048)).toBe(true);
  expect(isVncFramebufferSizeAllowed(8193, 1)).toBe(false);
  expect(isVncFramebufferSizeAllowed(4097, 4097)).toBe(false);
  expect(isVncFramebufferSizeAllowed(0, 0)).toBe(true);

  expect(isVncCursorRectAllowed({ width: 256, height: 256, rgba: new Uint8ClampedArray(256 * 256 * 4) })).toBe(true);
  expect(isVncCursorRectAllowed({ width: 257, height: 1, rgba: new Uint8ClampedArray(257 * 4) })).toBe(false);
  expect(isVncCursorRectAllowed({ width: 32, height: 32, rgba: null })).toBe(false);
});

test('relocateVncPaneRoot moves the existing VNC shell into a new host container', () => {
  const root = { id: 'root' } as any;
  const hostBChildren: any[] = [];
  const hostB: any = {
    innerHTML: 'occupied',
    appendChild: (node: any) => hostBChildren.push(node),
  };

  expect(relocateVncPaneRoot(root, hostB)).toBe(true);
  expect(hostB.innerHTML).toBe('');
  expect(hostBChildren).toEqual([root]);
  expect(relocateVncPaneRoot(root, null)).toBe(false);
});

test('shouldRetryVncPopoutWithoutHandoff only retries pristine failed handoffs', () => {
  expect(shouldRetryVncPopoutWithoutHandoff({
    handoffToken: 'token-1',
    bytesIn: 0,
    hasRenderedFrame: false,
    reconnectAttempts: 0,
  })).toBe(true);

  expect(shouldRetryVncPopoutWithoutHandoff({
    handoffToken: '',
    bytesIn: 0,
    hasRenderedFrame: false,
    reconnectAttempts: 0,
  })).toBe(false);

  expect(shouldRetryVncPopoutWithoutHandoff({
    handoffToken: 'token-1',
    bytesIn: 10,
    hasRenderedFrame: false,
    reconnectAttempts: 0,
  })).toBe(false);

  expect(shouldRetryVncPopoutWithoutHandoff({
    handoffToken: 'token-1',
    bytesIn: 0,
    hasRenderedFrame: true,
    reconnectAttempts: 0,
  })).toBe(false);

  expect(shouldRetryVncPopoutWithoutHandoff({
    handoffToken: 'token-1',
    bytesIn: 0,
    hasRenderedFrame: false,
    reconnectAttempts: 1,
  })).toBe(false);
});

test('getVncTargetsEmptyStateCopy matches whether direct connect is actually available', () => {
  expect(getVncTargetsEmptyStateCopy({
    enabled: false,
    directConnectEnabled: false,
    targets: [],
  })).toEqual({
    title: 'VNC is not configured yet.',
    body: 'No saved targets are available and direct connect is disabled on this host.',
  });

  expect(getVncTargetsEmptyStateCopy({
    enabled: true,
    directConnectEnabled: false,
    targets: [],
  })).toEqual({
    title: 'No saved VNC targets yet.',
    body: 'This host has no configured VNC targets, and direct connect is disabled.',
  });

  expect(getVncTargetsEmptyStateCopy({
    enabled: true,
    directConnectEnabled: true,
    targets: [],
  })).toEqual({
    title: 'No saved VNC targets yet.',
    body: 'Connect directly above.',
  });
});
