
### 额外依赖许可
- `index.ts` 为纯逻辑（只有 `loadAIConfig/saveAIConfig/clearAIConfig` 可访问 `localStorage`，且需 try/catch 兼容不可用环境）；`CopilotSidebar.tsx` 可使用 `react`、`lucide-react`、Tailwind 类名。
- 绝不能 `console.log` 任何包含 apiKey 的对象；请求只能发往 `config.baseUrl`（或各提供商官方默认地址）。Anthropic 浏览器直连需加 `anthropic-dangerous-direct-browser-access: true` 头；Gemini 使用 `generativelanguage.googleapis.com` 的 `streamGenerateContent?alt=sse`。

### 必须导出的接口约定（名称与签名不可更改）
```ts
// index.ts
export const AI_CONFIG_STORAGE_KEY = 'opensnapgene_ai_config';
export const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; model: string }>;
export function loadAIConfig(): AIConfig | null;
export function saveAIConfig(config: AIConfig): void;
export function clearAIConfig(): void;
export function buildPlasmidContextPrompt(doc: PlasmidDocument, cutSites: CutSite[], selection: SelectionRange | null, sangerTraces: SangerTraceData[]): string;
export function buildSystemPrompt(): string;
export function parseAssistantReply(text: string): { content: string; actions: AIToolAction[] }; // 解析并剥离 <opensnapgene_action> 块
export function validateAction(action: unknown, doc: PlasmidDocument): { ok: true; action: AIToolAction } | { ok: false; error: string }; // 严格 schema 与坐标边界校验
export function streamChat(config: AIConfig, messages: AIChatMessage[], onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>;
export const QUICK_PROMPTS: Array<{ id: string; icon: string; label: string; prompt: string }>;
// CopilotSidebar.tsx
export interface CopilotSidebarProps { doc: PlasmidDocument; cutSites: CutSite[]; selection: SelectionRange | null; traces: SangerTraceData[]; onApplyAction: (action: AIToolAction) => void; open: boolean; onClose: () => void; }
export function CopilotSidebar(props: CopilotSidebarProps): JSX.Element;
```
- 测试 `ai-copilot.test.ts`：上下文压缩器输出包含特征坐标且不含全序列（10kb 测试质粒）、`parseAssistantReply` 解析多个动作、`validateAction` 拒绝越界坐标与未知类型、`streamChat` 使用注入的 mock `fetch` 解析 OpenAI SSE 流。
