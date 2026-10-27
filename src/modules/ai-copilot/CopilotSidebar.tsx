// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Dna,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  Microscope,
  Scissors,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AIChatMessage,
  AIConfig,
  AIProviderType,
  AIToolAction,
  CutSite,
  PlasmidDocument,
  SangerTraceData,
  SelectionRange,
} from '../../types/schema';
import {
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

export interface CopilotSidebarProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  selection: SelectionRange | null;
  traces: SangerTraceData[];
  onApplyAction: (action: AIToolAction) => void;
  open: boolean;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<AIProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  custom_openai: '自定义 OpenAI 兼容端点',
};

const CLONING_METHOD_LABELS: Record<'gibson' | 'restriction' | 'mutagenesis', string> = {
  gibson: 'Gibson 同源重组',
  restriction: '限制性内切酶',
  mutagenesis: '定点突变',
};

const ACTION_META: Record<
  AIToolAction['type'],
  { label: string; button: string; icon: 'primer' | 'feature' | 'digest' | 'highlight' | 'simulate' }
> = {
  DESIGN_PRIMERS: { label: '引物设计', button: '一键应用引物设计', icon: 'primer' },
  ADD_FEATURES: { label: '特征注释', button: '应用特征注释', icon: 'feature' },
  RUN_DIGESTION: { label: '酶切鉴定', button: '在虚拟电泳中预览', icon: 'digest' },
  HIGHLIGHT_RANGE: { label: '区间高亮', button: '高亮问题区间', icon: 'highlight' },
  SIMULATE_CLONING: { label: '克隆模拟', button: '模拟克隆方案', icon: 'simulate' },
};

interface ConfigFormState {
  provider: AIProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: string;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formFromConfig(config: AIConfig | null): ConfigFormState {
  const provider: AIProviderType = config?.provider ?? 'deepseek';
  return {
    provider,
    apiKey: config?.apiKey ?? '',
    baseUrl: config?.baseUrl ?? PROVIDER_DEFAULTS[provider].baseUrl,
    model: config?.model ?? PROVIDER_DEFAULTS[provider].model,
    temperature: config?.temperature !== undefined ? String(config.temperature) : '',
  };
}

function describeAction(action: AIToolAction): string {
  switch (action.type) {
    case 'DESIGN_PRIMERS': {
      const tails: string[] = [];
      if (action.payload.forwardTail) tails.push(`F 尾 ${action.payload.forwardTail}`);
      if (action.payload.reverseTail) tails.push(`R 尾 ${action.payload.reverseTail}`);
      if (action.payload.mutationSeq) tails.push(`突变序列 ${action.payload.mutationSeq}`);
      return [
        `目标区间 [${action.payload.targetStart}, ${action.payload.targetEnd})`,
        CLONING_METHOD_LABELS[action.payload.cloningMethod],
        ...tails,
      ].join(' · ');
    }
    case 'ADD_FEATURES':
      return `${action.payload.features.length} 个特征：${action.payload.features
        .slice(0, 4)
        .map((feature) => `${feature.name} [${feature.start}, ${feature.end})`)
        .join('、')}${action.payload.features.length > 4 ? ' …' : ''}`;
    case 'RUN_DIGESTION':
      return `推荐酶组合：${action.payload.enzymeNames.join(' + ')}`;
    case 'HIGHLIGHT_RANGE':
      return `区间 [${action.payload.start}, ${action.payload.end}) · ${action.payload.reason}`;
    case 'SIMULATE_CLONING':
      return [
        action.payload.method,
        `${action.payload.fragmentIds.length} 个片段`,
        action.payload.enzymes && action.payload.enzymes.length > 0
          ? action.payload.enzymes.join(' + ')
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return '';
  }
}

function ActionIcon({ kind }: { kind: 'primer' | 'feature' | 'digest' | 'highlight' | 'simulate' }) {
  if (kind === 'primer') return <Wand2 className="h-4 w-4" aria-hidden="true" />;
  if (kind === 'feature') return <Dna className="h-4 w-4" aria-hidden="true" />;
  if (kind === 'digest') return <Scissors className="h-4 w-4" aria-hidden="true" />;
  if (kind === 'highlight') return <Sparkles className="h-4 w-4" aria-hidden="true" />;
  return <FlaskConical className="h-4 w-4" aria-hidden="true" />;
}

function QuickIcon({ id }: { id: string }) {
  const className = 'h-4 w-4 shrink-0';
  if (id === 'plan-cloning') return <Dna className={className} aria-hidden="true" />;
  if (id === 'troubleshoot-cloning') return <AlertTriangle className={className} aria-hidden="true" />;
  if (id === 'interpret-sanger') return <Microscope className={className} aria-hidden="true" />;
  return <FlaskConical className={className} aria-hidden="true" />;
}

export function CopilotSidebar(props: CopilotSidebarProps): JSX.Element {
  const { doc, cutSites, selection, traces, onApplyAction, open, onClose } = props;
  const [config, setConfig] = useState<AIConfig | null>(() => loadAIConfig());
  const [configOpen, setConfigOpen] = useState(false);
  const [form, setForm] = useState<ConfigFormState>(() => formFromConfig(loadAIConfig()));
  const [formError, setFormError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appliedActions, setAppliedActions] = useState<Record<string, boolean>>({});

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AIChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (configOpen) {
      setForm(formFromConfig(config));
      setFormError(null);
      setShowApiKey(false);
    }
  }, [configOpen, config]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (configOpen) {
        setConfigOpen(false);
        return;
      }
      handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, configOpen, handleClose]);

  const sendPrompt = useCallback(
    async (promptOverride?: string) => {
      const prompt = (promptOverride ?? draft).trim();
      if (!prompt || busyRef.current) return;

      if (!config) {
        setDraft(prompt);
        setForm(formFromConfig(null));
        setConfigOpen(true);
        setNotice('请先保存 AI 服务配置，再发送这条指令。');
        return;
      }

      setDraft('');
      setError(null);
      setNotice(null);

      const userMessage: AIChatMessage = {
        id: createId('user'),
        role: 'user',
        content: prompt,
        timestamp: nowIso(),
      };
      const assistantId = createId('assistant');
      const assistantMessage: AIChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: nowIso(),
      };

      const history = [...messagesRef.current.filter((message) => message.role !== 'system'), userMessage];
      setMessages((previous) => [...previous, userMessage, assistantMessage]);

      const controller = new AbortController();
      abortRef.current = controller;
      busyRef.current = true;
      setBusy(true);

      const systemMessage: AIChatMessage = {
        id: createId('system'),
        role: 'system',
        content: `${buildSystemPrompt()}\n\n${buildPlasmidContextPrompt(
          doc,
          cutSites,
          selection,
          traces,
        )}`,
        timestamp: nowIso(),
      };
      const apiMessages: AIChatMessage[] = [
        systemMessage,
        ...history.slice(-16).map((message) => ({
          ...message,
          proposedActions: undefined,
        })),
      ];

      try {
        const fullText = await streamChat(
          config,
          apiMessages,
          (delta) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            );
          },
          controller.signal,
        );

        const parsed = parseAssistantReply(fullText);
        const validActions: AIToolAction[] = [];
        let rejectedCount = 0;
        for (const candidate of parsed.actions) {
          const result = validateAction(candidate, doc);
          if (result.ok) validActions.push(result.action);
          else rejectedCount += 1;
        }

        const rejectionNote =
          rejectedCount > 0
            ? `\n\n（${rejectedCount} 个建议操作因坐标或参数不符合规范已被安全忽略。）`
            : '';
        const finalContent =
          (parsed.content || (validActions.length > 0 ? '已生成可执行操作建议，请查看下方卡片。' : 'AI 未返回文本内容，请重试。')) +
          rejectionNote;

        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: finalContent,
                  proposedActions: validActions.length > 0 ? validActions : undefined,
                }
              : message,
          ),
        );
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: message.content
                      ? `${message.content}\n\n（已停止生成）`
                      : '（已停止生成）',
                  }
                : message,
            ),
          );
        } else {
          const message =
            caught instanceof Error && caught.message
              ? caught.message
              : '请求失败，请检查网络连接与 API 配置。';
          setError(message);
          setMessages((previous) =>
            previous
              .map((item) =>
                item.id === assistantId
                  ? item.content
                    ? { ...item, content: `${item.content}\n\n（生成中断）` }
                    : null
                  : item,
              )
              .filter((item): item is AIChatMessage => item !== null),
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [config, draft, doc, cutSites, selection, traces],
  );

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleApply = (messageId: string, index: number, action: AIToolAction) => {
    const key = `${messageId}:${index}`;
    try {
      onApplyAction(action);
      setAppliedActions((previous) => ({ ...previous, [key]: true }));
      setNotice(`已应用：${ACTION_META[action.type].label}`);
    } catch {
      setError('应用该操作时出现问题，请稍后重试。');
    }
  };

  const handleProviderChange = (provider: AIProviderType) => {
    setForm((previous) => ({
      ...previous,
      provider,
      baseUrl: PROVIDER_DEFAULTS[provider].baseUrl,
      model: PROVIDER_DEFAULTS[provider].model,
    }));
  };

  const handleSaveConfig = () => {
    const apiKey = form.apiKey.trim();
    const baseUrl = form.baseUrl.trim();
    const model = form.model.trim();

    if (!apiKey) {
      setFormError('请填写 API Key。');
      return;
    }
    if (!baseUrl) {
      setFormError('请填写 Base URL。');
      return;
    }
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setFormError('Base URL 必须使用 http:// 或 https://。');
        return;
      }
    } catch {
      setFormError('Base URL 格式无效。');
      return;
    }
    if (!model) {
      setFormError('请填写模型名称。');
      return;
    }

    let temperature: number | undefined;
    if (form.temperature.trim().length > 0) {
      const parsedTemperature = Number(form.temperature);
      if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
        setFormError('Temperature 必须是 0 到 2 之间的数字。');
        return;
      }
      temperature = parsedTemperature;
    }

    const nextConfig: AIConfig = { provider: form.provider, apiKey, baseUrl, model };
    if (temperature !== undefined) nextConfig.temperature = temperature;

    try {
      saveAIConfig(nextConfig);
      setConfig(nextConfig);
      setConfigOpen(false);
      setFormError(null);
      setNotice('AI 配置已保存在本机浏览器。');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '配置保存失败。');
    }
  };

  const handleClearConfig = () => {
    clearAIConfig();
    setConfig(null);
    setForm(formFromConfig(null));
    setFormError(null);
    setShowApiKey(false);
    setNotice('已清除本机保存的 API Key 与模型配置。');
  };

  if (!open) return <></>;

  const isEmpty = messages.length === 0;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-700/80 bg-slate-900 text-slate-100 shadow-2xl"
      aria-label="AI 实验导师"
    >
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300 ring-1 ring-teal-400/30">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold tracking-wide">AI 实验导师</h2>
            <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-300">
              BYOK
            </span>
          </div>
          <p className="truncate text-xs text-slate-400">
            {config
              ? `${PROVIDER_LABELS[config.provider]} · ${config.model}`
              : '浏览器直连模型 API，不经过第三方服务器'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          aria-label="打开 AI 服务设置"
          title="AI 服务设置"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          aria-label="关闭 AI 实验导师"
          title="关闭"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((quickPrompt) => (
            <button
              key={quickPrompt.id}
              type="button"
              disabled={busy}
              onClick={() => void sendPrompt(quickPrompt.prompt)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-teal-500/60 hover:bg-slate-800 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
              title={quickPrompt.prompt}
            >
              <span aria-hidden="true">{quickPrompt.icon}</span>
              <QuickIcon id={quickPrompt.id} />
              <span>{quickPrompt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {!config && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-200">尚未配置 AI 服务</p>
            <p className="mt-0.5 text-amber-100/80">
              API Key 只保存在本机 localStorage，并直接发送给所选服务商。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="shrink-0 rounded-md border border-amber-400/40 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-400/10"
          >
            配置
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 text-rose-300 hover:bg-rose-500/20"
            aria-label="关闭错误提示"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {notice && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-teal-500/25 bg-teal-500/10 px-3 py-2 text-xs text-teal-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded p-0.5 text-teal-300 hover:bg-teal-500/20"
            aria-label="关闭提示"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300 ring-1 ring-teal-400/20">
              <Bot className="h-7 w-7" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-200">从一个实验问题开始</h3>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
              我会读取当前质粒的注释、单酶切位点、Type IIS 位点、Sanger 突变与选中区域上下文，
              给出可执行的克隆建议。全序列不会发送给模型。
            </p>
            <div className="mt-4 grid w-full max-w-xs grid-cols-1 gap-2 text-left">
              {QUICK_PROMPTS.slice(0, 3).map((quickPrompt) => (
                <button
                  key={quickPrompt.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendPrompt(quickPrompt.prompt)}
                  className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-800/50 px-3 py-2 text-xs text-slate-300 transition hover:border-teal-500/50 hover:text-teal-200 disabled:opacity-50"
                >
                  <span aria-hidden="true">{quickPrompt.icon}</span>
                  <span>{quickPrompt.label}</span>
                  <ChevronDown className="ml-auto h-3.5 w-3.5 -rotate-90 text-slate-500" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div key={message.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                <div className={isUser ? 'ml-8 max-w-[85%]' : 'mr-3 max-w-[92%]'}>
                  <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {isUser ? (
                      <>
                        <span>你</span>
                      </>
                    ) : (
                      <>
                        <Bot className="h-3 w-3" aria-hidden="true" />
                        <span>AI 导师</span>
                      </>
                    )}
                  </div>
                  <div
                    className={
                      isUser
                        ? 'whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-teal-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm'
                        : 'whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-slate-700/70 bg-slate-800/80 px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 shadow-sm'
                    }
                  >
                    {message.content || (busy ? '正在分析质粒上下文…' : '（空回复）')}
                  </div>

                  {message.proposedActions && message.proposedActions.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {message.proposedActions.map((action, index) => {
                        const key = `${message.id}:${index}`;
                        const applied = appliedActions[key] === true;
                        const meta = ACTION_META[action.type];
                        return (
                          <div
                            key={key}
                            className="rounded-xl border border-teal-500/25 bg-slate-800/60 p-3 shadow-sm"
                          >
                            <div className="flex items-center gap-2 text-teal-300">
                              <ActionIcon kind={meta.icon} />
                              <span className="text-[11px] font-semibold uppercase tracking-wide">
                                {meta.label}
                              </span>
                            </div>
                            <p className="mt-1.5 break-words text-xs leading-relaxed text-slate-300">
                              {describeAction(action)}
                            </p>
                            <button
                              type="button"
                              disabled={applied}
                              onClick={() => handleApply(message.id, index, action)}
                              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-default disabled:bg-slate-700 disabled:text-slate-300"
                            >
                              {applied ? (
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {applied ? '已应用' : meta.button}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        className="border-t border-slate-800 bg-slate-900/95 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendPrompt();
        }}
      >
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 focus-within:border-teal-500/70 focus-within:ring-1 focus-within:ring-teal-500/20">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendPrompt();
              }
            }}
            rows={2}
            placeholder={
              config
                ? '描述你的克隆目标、酶切问题或测序疑问…（Enter 发送，Shift+Enter 换行）'
                : '配置 API 后可发送问题；也可以先点击上方快捷指令…'
            }
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none"
            aria-label="向 AI 实验导师提问"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-slate-500">
              {config ? 'AI 建议需人工验证，不会自动执行实验操作' : 'Key 仅存于本机浏览器'}
            </span>
            {busy ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-rose-500/50 hover:text-rose-200"
                aria-label="停止生成"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="发送问题"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                发送
              </button>
            )}
          </div>
        </div>
        {busy && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-teal-300">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            <span>正在流式生成，可随时停止</span>
          </div>
        )}
      </form>

      {configOpen && (
        <div
          className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfigOpen(false);
          }}
        >
          <div
            className="my-4 w-full rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-config-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="ai-config-title" className="text-sm font-semibold text-slate-100">
                  AI 服务设置
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  BYOK · 浏览器直连 · 配置仅保存在本机
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="关闭设置"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-300">服务提供商</span>
                <select
                  value={form.provider}
                  onChange={(event) => handleProviderChange(event.target.value as AIProviderType)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
                >
                  {(Object.keys(PROVIDER_LABELS) as AIProviderType[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-300">
                  <span>API Key</span>
                  <span className="font-normal text-slate-500">仅保存在本机 localStorage</span>
                </span>
                <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950 focus-within:border-teal-500">
                  <KeyRound className="ml-3 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(event) => setForm((previous) => ({ ...previous, apiKey: event.target.value }))}
                    placeholder={form.provider === 'gemini' ? 'Google AI Studio API Key' : 'sk-…'}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((previous) => !previous)}
                    className="mr-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    title={showApiKey ? '隐藏' : '显示'}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-300">Base URL</span>
                <input
                  type="url"
                  value={form.baseUrl}
                  onChange={(event) => setForm((previous) => ({ ...previous, baseUrl: event.target.value }))}
                  placeholder={PROVIDER_DEFAULTS[form.provider].baseUrl}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
                />
                {form.provider === 'custom_openai' && (
                  <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">
                    可填写 Ollama（如 http://localhost:11434/v1）或 OpenRouter 等 OpenAI 兼容端点。
                  </span>
                )}
              </label>

              <div className="grid grid-cols-[1fr_104px] gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-300">模型名称</span>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(event) => setForm((previous) => ({ ...previous, model: event.target.value }))}
                    placeholder={PROVIDER_DEFAULTS[form.provider].model}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-300">Temperature</span>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={form.temperature}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, temperature: event.target.value }))
                    }
                    placeholder="默认"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
                <p>
                  请求由当前浏览器直接发往所选服务商。Anthropic 使用官方浏览器直连头；Gemini 使用
                  <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                    streamGenerateContent?alt=sse
                  </code>
                  端点。不会经过 GATC 或任何第三方服务器。
                </p>
                <p className="mt-1.5">请勿在共享电脑上保存生产环境密钥。可随时一键清除本机配置。</p>
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-words">{formError}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClearConfig}
                  disabled={!config}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  清除本机配置
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfigOpen(false)}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-teal-400"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    保存配置
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
