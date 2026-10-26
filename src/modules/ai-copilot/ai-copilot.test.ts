import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AIChatMessage,
  AIConfig,
  CutSite,
  PlasmidDocument,
  RestrictionEnzyme,
  SangerTraceData,
} from '../../types/schema';
import { CopilotSidebar } from './CopilotSidebar';
import {
  AI_CONFIG_STORAGE_KEY,
  PROVIDER_DEFAULTS,
  QUICK_PROMPTS,
  buildPlasmidContextPrompt,
  buildSystemPrompt,
  clearAIConfig,
  loadAIConfig,
  parseAssistantReply,
  saveAIConfig,
  streamChat,
  validateAction,
} from './index';

function makeSequence(length: number): string {
  const bases = ['A', 'C', 'G', 'T'];
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    sequence += bases[(index * 7 + index * index * 3 + Math.floor(index / 5)) % 4];
  }
  return sequence;
}

function enzyme(overrides: Partial<RestrictionEnzyme> = {}): RestrictionEnzyme {
  return {
    name: 'EcoRI',
    recognitionSeq: 'GAATTC',
    cutIndexTop: 1,
    cutIndexBottom: 5,
    suppliers: ['NEB'],
    ...overrides,
  };
}

function cutSite(overrides: Partial<CutSite> = {}): CutSite {
  return {
    id: 'cut-1',
    enzyme: enzyme(),
    position: 1000,
    strand: 1,
    cutPositionTop: 1001,
    cutPositionBottom: 1005,
    overhangType: '5-prime',
    overhangSeq: 'AATT',
    isMethylationBlocked: false,
    totalCutsInPlasmid: 1,
    ...overrides,
  };
}

function makeDoc(sequenceLength = 10000): PlasmidDocument {
  return {
    id: 'doc-pTest',
    name: 'pTest-EGFP',
    sequence: makeSequence(sequenceLength),
    topology: 'circular',
    length: sequenceLength,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    description: 'Test plasmid for context compression',
    methylationProfile: { dam: true, dcm: true, cpg: false },
    features: [
      {
        id: 'feature-egfp',
        name: 'EGFP',
        type: 'CDS',
        start: 100,
        end: 800,
        strand: 1,
        color: '#00ffcc',
        codonStart: 1,
        translation: 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTF',
      },
      {
        id: 'feature-amp',
        name: 'AmpR promoter',
        type: 'promoter',
        start: 9000,
        end: 9200,
        strand: -1,
        color: '#ff8800',
      },
    ],
    primers: [
      {
        id: 'primer-fwd',
        name: 'EGFP_F',
        sequence: 'ACGTACGTACGTACGTACGT',
        bindingStart: 100,
        bindingEnd: 120,
        strand: 1,
        tailSequence: '',
        tmAnnealing: 58.4,
        tmTotal: 58.4,
        gcPercent: 50,
        has3PrimeGCClamp: false,
        hairpinDeltaG: -1.2,
        selfDimerDeltaG: -4.8,
      },
    ],
    history: [],
  };
}

function makeTrace(): SangerTraceData {
  return {
    id: 'trace-1',
    fileName: 'pTest_EGFP.ab1',
    calledSequence: 'ACGTACGTACGT',
    qualityScores: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
    baseLocations: Array.from({ length: 12 }, (_, index) => index * 10),
    trimRange: [1, 10],
    traces: {
      A: [1, 2, 3],
      T: [1, 2, 3],
      G: [1, 2, 3],
      C: [1, 2, 3],
    },
    alignment: {
      refStart: 1000,
      refEnd: 1012,
      strand: 1,
      identityPercent: 99.2,
      alignedRef: 'ACGTACGTACGT',
      alignedQuery: 'ACGTTCGTACGT',
      mismatches: [
        {
          refIndex: 2050,
          queryIndex: 4,
          type: 'substitution',
          refBase: 'A',
          queryBase: 'T',
          aminoAcidImpact: 'Missense (N684I in EGFP)',
        },
      ],
    },
  };
}

function openAIResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const baseConfig: AIConfig = {
  provider: 'openai',
  apiKey: 'sk-test-secret',
  baseUrl: 'https://api.test/v1',
  model: 'test-model',
  temperature: 0.2,
};

const testMessages: AIChatMessage[] = [
  {
    id: 'system-1',
    role: 'system',
    content: 'You are a cloning mentor.',
    timestamp: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user-1',
    role: 'user',
    content: 'Help me clone EGFP.',
    timestamp: '2026-01-01T00:00:01.000Z',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPlasmidContextPrompt', () => {
  it('includes feature coordinates, cutters, methylation, Sanger mutations and local selection sequence without the full plasmid', () => {
    const doc = makeDoc(10000);
    const cutSites: CutSite[] = [
      cutSite({ id: 'ecori', position: 1450, cutPositionTop: 1451, cutPositionBottom: 1455 }),
      cutSite({
        id: 'bsai',
        enzyme: enzyme({
          name: 'BsaI',
          recognitionSeq: 'GGTCTC',
          cutIndexTop: 7,
          cutIndexBottom: 11,
          isTypeIIS: true,
        }),
        position: 3000,
        cutPositionTop: 3007,
        cutPositionBottom: 2996,
        overhangType: '5-prime',
        overhangSeq: 'GATC',
      }),
      cutSite({
        id: 'bamhi-1',
        enzyme: enzyme({ name: 'BamHI', recognitionSeq: 'GGATCC', cutIndexTop: 1, cutIndexBottom: 5 }),
        position: 6000,
        cutPositionTop: 6001,
        cutPositionBottom: 6005,
        overhangSeq: 'GATC',
        totalCutsInPlasmid: 2,
      }),
      cutSite({
        id: 'bamhi-2',
        enzyme: enzyme({ name: 'BamHI', recognitionSeq: 'GGATCC', cutIndexTop: 1, cutIndexBottom: 5 }),
        position: 7000,
        cutPositionTop: 7001,
        cutPositionBottom: 7005,
        overhangSeq: 'GATC',
        totalCutsInPlasmid: 2,
      }),
    ];

    const context = buildPlasmidContextPrompt(
      doc,
      cutSites,
      { start: 2000, end: 2200, strand: 1 },
      [makeTrace()],
    );

    expect(context).toContain('pTest-EGFP');
    expect(context).toContain('10000 bp');
    expect(context).toContain('GC 含量');
    expect(context).toContain('Dam=');
    expect(context).toContain('Dcm=');
    expect(context).toContain('CpG=');
    expect(context).toContain('EGFP');
    expect(context).toContain('start=100');
    expect(context).toContain('end=800');
    expect(context).toContain('strand=+ (forward)');
    expect(context).toContain('AmpR promoter');
    expect(context).toContain('EcoRI');
    expect(context).toContain('BsaI');
    expect(context).toContain('Type IIS');
    expect(context).toContain('BamHI');
    expect(context).toContain('positions=');
    expect(context).toContain('pTest_EGFP.ab1');
    expect(context).toContain('refIndex=2050');
    expect(context).toContain('Missense (N684I in EGFP)');
    expect(context).toContain('上游 100 bp');
    expect(context).toContain('选中区域 / Selected region [2000, 2200)');
    expect(context).toContain('下游 100 bp');
    expect(context).toContain(doc.sequence.slice(1900, 2000));
    expect(context).toContain(doc.sequence.slice(2000, 2200));
    expect(context).toContain(doc.sequence.slice(2200, 2300));
    expect(context).not.toContain(doc.sequence);
    expect(context.length).toBeLessThan(12000);
  });

  it('caps a very large selection so the full plasmid is never emitted', () => {
    const doc = makeDoc(10000);
    const context = buildPlasmidContextPrompt(doc, [], { start: 0, end: 10000 }, []);
    expect(context).toContain('省略');
    expect(context).not.toContain(doc.sequence);
  });

  it('caps a whole-plasmid selection on a mid-sized plasmid', () => {
    const doc = makeDoc(6000);
    const context = buildPlasmidContextPrompt(doc, [], { start: 0, end: 6000 }, []);
    expect(context).toContain('省略');
    expect(context).not.toContain(doc.sequence);
  });

  it('handles an empty selection and missing optional metadata', () => {
    const doc = makeDoc(2000);
    doc.methylationProfile = undefined;
    const context = buildPlasmidContextPrompt(doc, [], null, []);
    expect(context).toContain('未提供选区');
    expect(context).toContain('Dam=ON');
    expect(context).toContain('Dcm=ON');
    expect(context).toContain('CpG=OFF');
  });

  it('resolves circular wrap-around selections', () => {
    const doc = makeDoc(1000);
    const context = buildPlasmidContextPrompt(doc, [], { start: 950, end: 50 }, []);
    expect(context).toContain(doc.sequence.slice(950, 1000));
    expect(context).toContain(doc.sequence.slice(0, 50));
    expect(context).toContain('上游 100 bp');
    expect(context).toContain('下游 100 bp');
    expect(context).not.toContain(doc.sequence);
  });
});

describe('parseAssistantReply', () => {
  it('parses multiple action blocks and arrays while removing them from display text', () => {
    const reply = [
      '建议先做双酶切鉴定。',
      '',
      '<opensnapgene_action>',
      '{"type":"RUN_DIGESTION","payload":{"enzymeNames":["EcoRI","BamHI"]}}',
      '</opensnapgene_action>',
      '',
      '<opensnapgene_action>[{"type":"HIGHLIGHT_RANGE","payload":{"start":100,"end":200,"reason":"疑似移码"}},{"type":"ADD_FEATURES","payload":{"features":[{"name":"test","type":"misc_feature","start":10,"end":50,"strand":1,"color":"#123456"}]}}]</opensnapgene_action>',
      '',
      '请确认后执行。',
    ].join('\n');

    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toHaveLength(3);
    expect(parsed.actions.map((action) => action.type)).toEqual([
      'RUN_DIGESTION',
      'HIGHLIGHT_RANGE',
      'ADD_FEATURES',
    ]);
    expect(parsed.content).toBe('建议先做双酶切鉴定。\n\n请确认后执行。');
    expect(parsed.content).not.toContain('opensnapgene_action');
    expect(parsed.content).not.toContain('RUN_DIGESTION');
  });

  it('ignores unknown action types and malformed JSON blocks', () => {
    const reply = [
      '文字内容。',
      '<opensnapgene_action>{"type":"DELETE_PLASMID","payload":{}}</opensnapgene_action>',
      '<opensnapgene_action>{not valid json}</opensnapgene_action>',
    ].join('\n');

    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toEqual([]);
    expect(parsed.content).toBe('文字内容。');
  });

  it('handles fenced action blocks and empty replies', () => {
    const reply = ['```json', '<opensnapgene_action>{"type":"HIGHLIGHT_RANGE","payload":{"start":1,"end":2,"reason":"x"}}</opensnapgene_action>', '```'].join('\n');
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.content).toBe('');
    expect(parseAssistantReply('')).toEqual({ content: '', actions: [] });
  });

  it('parses an actions wrapper object', () => {
    const reply =
      '<opensnapgene_action>{"actions":[{"type":"RUN_DIGESTION","payload":{"enzymeNames":["PstI"]}}]}</opensnapgene_action>';
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toEqual([
      { type: 'RUN_DIGESTION', payload: { enzymeNames: ['PstI'] } },
    ]);
  });

  it('parses multiple top-level JSON objects inside one action block', () => {
    const reply = [
      '<opensnapgene_action>',
      '{"type":"RUN_DIGESTION","payload":{"enzymeNames":["EcoRI"]}}',
      '{"type":"HIGHLIGHT_RANGE","payload":{"start":10,"end":20,"reason":"check"}}',
      '</opensnapgene_action>',
    ].join('\n');
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions.map((action) => action.type)).toEqual([
      'RUN_DIGESTION',
      'HIGHLIGHT_RANGE',
    ]);
    expect(parsed.content).toBe('');
  });
});

describe('validateAction', () => {
  it('accepts a valid primer design action and normalizes optional tails', () => {
    const doc = makeDoc(5000);
    const result = validateAction(
      {
        type: 'DESIGN_PRIMERS',
        payload: {
          targetStart: 100,
          targetEnd: 700,
          cloningMethod: 'gibson',
          forwardTail: 'gaattc',
          reverseTail: 'GGATCC',
        },
      },
      doc,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action.type).toBe('DESIGN_PRIMERS');
      if (result.action.type === 'DESIGN_PRIMERS') {
        expect(result.action.payload.forwardTail).toBe('GAATTC');
        expect(result.action.payload.targetStart).toBe(100);
      }
    }
  });

  it('accepts a wrap-around feature on a circular plasmid but rejects it on a linear plasmid', () => {
    const circularDoc = makeDoc(5000);
    const feature = {
      name: 'split feature',
      type: 'misc_feature',
      start: 4950,
      end: 20,
      strand: 1,
      color: '#123456',
    };

    const circularResult = validateAction(
      { type: 'ADD_FEATURES', payload: { features: [feature] } },
      circularDoc,
    );
    expect(circularResult.ok).toBe(true);

    const linearResult = validateAction(
      { type: 'ADD_FEATURES', payload: { features: [feature] } },
      { ...circularDoc, topology: 'linear' },
    );
    expect(linearResult.ok).toBe(false);
  });

  it('rejects unknown actions, out-of-bounds coordinates, and malformed payloads', () => {
    const doc = makeDoc(5000);

    expect(validateAction({ type: 'DELETE_PLASMID', payload: {} }, doc).ok).toBe(false);
    expect(
      validateAction(
        { type: 'DESIGN_PRIMERS', payload: { targetStart: 10, targetEnd: 6000, cloningMethod: 'gibson' } },
        doc,
      ).ok,
    ).toBe(false);
    expect(
      validateAction(
        { type: 'DESIGN_PRIMERS', payload: { targetStart: -1, targetEnd: 100, cloningMethod: 'gibson' } },
        doc,
      ).ok,
    ).toBe(false);
    expect(
      validateAction(
        {
          type: 'ADD_FEATURES',
          payload: {
            features: [
              { name: 'bad', type: 'CDS', start: 0, end: 10, strand: 1, color: 'red' },
            ],
          },
        },
        doc,
      ).ok,
    ).toBe(false);
    expect(validateAction({ type: 'RUN_DIGESTION', payload: { enzymeNames: [] } }, doc).ok).toBe(false);
    expect(validateAction({ type: 'HIGHLIGHT_RANGE', payload: { start: 5, end: 5, reason: 'x' } }, doc).ok).toBe(false);
    expect(
      validateAction({ type: 'SIMULATE_CLONING', payload: { method: 'unknown', fragmentIds: ['a'] } }, doc).ok,
    ).toBe(false);
    expect(validateAction(null, doc).ok).toBe(false);
  });

  it('accepts valid digestion, highlight, and cloning simulation actions', () => {
    const doc = makeDoc(5000);

    const digestion = validateAction(
      { type: 'RUN_DIGESTION', payload: { enzymeNames: ['EcoRI', 'ecori', 'BamHI'] } },
      doc,
    );
    expect(digestion.ok).toBe(true);
    if (digestion.ok && digestion.action.type === 'RUN_DIGESTION') {
      expect(digestion.action.payload.enzymeNames).toEqual(['EcoRI', 'BamHI']);
    }

    const highlight = validateAction(
      { type: 'HIGHLIGHT_RANGE', payload: { start: 100, end: 250, reason: '  疑似移码  ' } },
      doc,
    );
    expect(highlight.ok).toBe(true);
    if (highlight.ok && highlight.action.type === 'HIGHLIGHT_RANGE') {
      expect(highlight.action.payload.reason).toBe('疑似移码');
    }

    const simulation = validateAction(
      {
        type: 'SIMULATE_CLONING',
        payload: { method: 'gibson_assembly', fragmentIds: ['doc-a', 'doc-b'], enzymes: ['EcoRI'] },
      },
      doc,
    );
    expect(simulation.ok).toBe(true);
  });

  it('accepts a linear range ending exactly at the plasmid length', () => {
    const doc = { ...makeDoc(1000), topology: 'linear' as const };
    const result = validateAction(
      { type: 'HIGHLIGHT_RANGE', payload: { start: 900, end: 1000, reason: 'terminator' } },
      doc,
    );
    expect(result.ok).toBe(true);
  });
});

describe('buildSystemPrompt and quick prompts', () => {
  it('documents the action protocol and every action type', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('<opensnapgene_action>');
    expect(prompt).toContain('</opensnapgene_action>');
    expect(prompt).toContain('DESIGN_PRIMERS');
    expect(prompt).toContain('ADD_FEATURES');
    expect(prompt).toContain('RUN_DIGESTION');
    expect(prompt).toContain('HIGHLIGHT_RANGE');
    expect(prompt).toContain('SIMULATE_CLONING');
    expect(prompt).toContain('0-based');
  });

  it('exposes the four required quick prompts', () => {
    expect(QUICK_PROMPTS).toHaveLength(4);
    expect(QUICK_PROMPTS.map((prompt) => prompt.label)).toEqual([
      '规划克隆方案',
      '排查酶切/克隆失败',
      '解读 Sanger 测序结果',
      '推荐鉴定酶切组合',
    ]);
  });
});

describe('streamChat', () => {
  it('parses an OpenAI-compatible SSE stream with chunk boundaries', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sse.slice(0, 17)));
            controller.enqueue(encoder.encode(sse.slice(17, 48)));
            controller.enqueue(encoder.encode(sse.slice(48)));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tokens: string[] = [];
    const result = await streamChat(baseConfig, testMessages, (delta) => tokens.push(delta));

    expect(result).toBe('你好，世界');
    expect(tokens.join('')).toBe('你好，世界');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-secret');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a cloning mentor.' },
      { role: 'user', content: 'Help me clone EGFP.' },
    ]);
  });

  it('sends Anthropic browser-direct headers and parses content_block_delta events', async () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"建议"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"使用 EcoRI"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(sse));
    vi.stubGlobal('fetch', fetchMock);

    const config: AIConfig = {
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://api.anthropic.test/v1',
      model: 'claude-test',
    };
    const result = await streamChat(config, testMessages, () => undefined);

    expect(result).toBe('建议使用 EcoRI');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.test/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('anthropic-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('claude-test');
    expect(body.stream).toBe(true);
    expect(body.system).toBe('You are a cloning mentor.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Help me clone EGFP.' }]);
  });

  it('uses Gemini streamGenerateContent with alt=sse and parses candidate parts', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"先做"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"菌落 PCR"}]}}]}',
      '',
    ].join('\n');

    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(sse));
    vi.stubGlobal('fetch', fetchMock);

    const config: AIConfig = {
      provider: 'gemini',
      apiKey: 'gemini-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-test',
    };
    const result = await streamChat(config, testMessages, () => undefined);

    expect(result).toBe('先做菌落 PCR');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-test:streamGenerateContent');
    expect(url).toContain('alt=sse');
    expect(url).toContain('key=gemini-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'You are a cloning mentor.' }],
    });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Help me clone EGFP.' }] }]);
  });

  it('falls back to a non-streaming JSON response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'fallback answer' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await streamChat(baseConfig, testMessages, () => undefined);
    expect(result).toBe('fallback answer');
  });

  it('redacts the API key from HTTP error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('invalid key sk-test-secret', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      ),
    );

    let message = '';
    try {
      await streamChat(baseConfig, testMessages, () => undefined);
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }

    expect(message).toContain('401');
    expect(message).not.toContain('sk-test-secret');
    expect(message).toContain('[redacted]');
  });

  it('supports abort signals', async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const tokens: string[] = [];
    const pending = streamChat(
      baseConfig,
      testMessages,
      (delta) => {
        tokens.push(delta);
        controller.abort();
      },
      controller.signal,
    );

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(tokens).toEqual(['partial']);
  });
});

describe('CopilotSidebar', () => {
  it('renders the BYOK sidebar and quick prompts without browser storage', () => {
    const doc = makeDoc(1000);
    const html = renderToStaticMarkup(
      createElement(CopilotSidebar, {
        doc,
        cutSites: [],
        selection: null,
        traces: [],
        onApplyAction: () => undefined,
        open: true,
        onClose: () => undefined,
      }),
    );

    expect(html).toContain('AI 实验导师');
    expect(html).toContain('规划克隆方案');
    expect(html).toContain('排查酶切/克隆失败');
    expect(html).toContain('解读 Sanger 测序结果');
    expect(html).toContain('推荐鉴定酶切组合');
    expect(html).toContain('尚未配置 AI 服务');

    const closedHtml = renderToStaticMarkup(
      createElement(CopilotSidebar, {
        doc,
        cutSites: [],
        selection: null,
        traces: [],
        onApplyAction: () => undefined,
        open: false,
        onClose: () => undefined,
      }),
    );
    expect(closedHtml).toBe('');
  });
});

describe('AI config persistence', () => {
  it('saves, loads, and clears the configuration under the documented key', () => {
    const store = new Map<string, string>();
    const storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as Storage;
    vi.stubGlobal('localStorage', storage);

    saveAIConfig(baseConfig);
    expect(store.has(AI_CONFIG_STORAGE_KEY)).toBe(true);
    expect(loadAIConfig()).toEqual(baseConfig);

    clearAIConfig();
    expect(loadAIConfig()).toBeNull();
    expect(store.has(AI_CONFIG_STORAGE_KEY)).toBe(false);
  });

  it('returns null when storage is unavailable or content is malformed', () => {
    const storage = {
      getItem: () => '{bad json',
    } as unknown as Storage;
    vi.stubGlobal('localStorage', storage);
    expect(loadAIConfig()).toBeNull();

    vi.stubGlobal('localStorage', undefined);
    expect(loadAIConfig()).toBeNull();
    expect(() => saveAIConfig(baseConfig)).not.toThrow();
    expect(() => clearAIConfig()).not.toThrow();
  });

  it('exposes provider defaults for every provider', () => {
    expect(Object.keys(PROVIDER_DEFAULTS).sort()).toEqual(
      ['anthropic', 'custom_openai', 'deepseek', 'gemini', 'openai'].sort(),
    );
    expect(PROVIDER_DEFAULTS.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(PROVIDER_DEFAULTS.deepseek.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(PROVIDER_DEFAULTS.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});
