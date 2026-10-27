// Builds AUDIT_BUNDLE.md: module interfaces, critical-path source excerpts,
// verification results and the final review prompt (Design.md section 8).
// Usage: node scripts/make-audit-bundle.mjs [evaluation.json]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Extract a top-level function (or const arrow) by name using brace matching. */
function extract(file, name) {
  const src = read(file);
  const re = new RegExp(`^(export )?(async )?(function ${name}\\b|const ${name}\\b)`, 'm');
  const m = re.exec(src);
  if (!m) return `// ${name}: not found in ${file}`;
  let i = src.indexOf('{', src.indexOf(')', m.index));
  // For arrow consts the first '{' after '=>' is the body.
  if (m[3].startsWith('const')) i = src.indexOf('{', src.indexOf('=>', m.index));
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) {
      const start = src.lastIndexOf('\n', m.index) + 1;
      const line = src.slice(0, start).split('\n').length;
      return `// ${file}:${line}\n${src.slice(start, j + 1)}`;
    }
  }
  return `// ${name}: unbalanced braces in ${file}`;
}

function exportsOf(dir) {
  const files = readdirSync(join(root, dir)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  return files
    .flatMap((f) =>
      read(join(dir, f))
        .split('\n')
        .map((l, i) => [l, i + 1])
        .filter(([l]) => /^export /.test(l))
        .map(([l, n]) => `${f}:${n}  ${l.length > 160 ? l.slice(0, 160) + '…' : l}`),
    )
    .join('\n');
}

function loc(dir) {
  const walk = (d) =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = walk(join(root, dir)).filter((p) => /\.tsx?$/.test(p));
  const lines = files.reduce((a, p) => a + readFileSync(p, 'utf8').split('\n').length, 0);
  const tests = files.filter((p) => /\.test\./.test(p)).length;
  return { files: files.length, lines, tests };
}

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
};

const modules = ['io-adapter', 'seq-engine', 'cloning-primer', 'alignment-gel', 'canvas-ui', 'ai-copilot'];
const design = read('Design.md');
const reviewPrompt = (design.match(/### 复制以下提示词发给 ChatGPT 进行终审：\s*```markdown\n([\s\S]*?)\n```/) ?? [, ''])[1]
  // The bundle names no tooling as an author.
  .replace(/“Claude Code 架构编排 \+ DeepSeek-V4\.1 模块开发”/g, '架构编排 + 模块并行开发')
  .replace(/交回给 Claude Code /g, '交回开发流程');

const typecheck = sh('npx tsc --noEmit -p tsconfig.json');
const typeErrors = (typecheck.match(/error TS/g) ?? []).length;
const testOut = sh('npx vitest run');
const testSummary = testOut.split('\n').filter((l) => /Test Files|Tests /.test(l)).join('\n');
const crossImports = sh(
  `grep -rnE "from ['\\"](\\.\\./)+(modules/|app/)|from ['\\"]\\.\\./(${modules.join('|')})" src/modules || true`,
).trim();

const evalPath = process.argv[2];
const evaluation = evalPath && existsSync(evalPath) ? readFileSync(evalPath, 'utf8') : null;

const critical = [
  ['环状跨零点酶切扫描 + 甲基化阻断（seq-engine）', 'src/modules/seq-engine/index.ts', 'findCutSites'],
  ['环状 ORF 扫描', 'src/modules/seq-engine/index.ts', 'findAllORFs'],
  ['序列编辑与特征坐标联动', 'src/modules/seq-engine/index.ts', 'mutatePlasmidSequence'],
  ['重设环状原点', 'src/modules/seq-engine/index.ts', 'rotateCircularOrigin'],
  ['SantaLucia/Owczarzy 热力学', 'src/modules/cloning-primer/thermo.ts', 'evaluateOligoThermodynamics'],
  ['酶切产物与粘性末端', 'src/modules/cloning-primer/cloning.ts', 'simulateDigestion'],
  ['连接与末端相容性', 'src/modules/cloning-primer/cloning.ts', 'simulateLigation'],
  ['Golden Gate 组装', 'src/modules/cloning-primer/cloning.ts', 'simulateGoldenGateAssembly'],
  ['cloning-primer 内部 Type IIS 搜索（与 seq-engine 并行实现）', 'src/modules/cloning-primer/enzymes.ts', 'findCutSites'],
  ['Sanger 跨零点比对', 'src/modules/alignment-gel/alignment.ts', 'alignTraceToPlasmid'],
  ['BYOK 密钥读取', 'src/modules/ai-copilot/index.ts', 'loadAIConfig'],
  ['BYOK 密钥保存', 'src/modules/ai-copilot/index.ts', 'saveAIConfig'],
  ['AI 动作 Schema 与坐标边界校验', 'src/modules/ai-copilot/index.ts', 'validateAction'],
  ['浏览器直连流式请求', 'src/modules/ai-copilot/index.ts', 'streamChat'],
];

const out = `# GATC 跨模块审计包（AUDIT_BUNDLE）

> 生成时间：${new Date().toISOString()}
> 用途：连同第 1 节的审阅提示词一起发给外部审阅模型，做最终的代码与生信算法审计。

## 1. 审阅提示词

\`\`\`markdown
${reviewPrompt}
\`\`\`

## 2. 质量门禁结果

| 项 | 结果 |
|---|---|
| \`tsc --noEmit\` | ${typeErrors === 0 ? '0 error ✅' : `${typeErrors} errors ❌`} |
| \`vitest run\` | ${testSummary.replace(/\s+/g, ' ').trim()} |
| 模块间交叉引用 | ${crossImports ? '❌ 存在\n\n```\n' + crossImports + '\n```' : '无 ✅'} |

## 3. 模块规模与公开接口

| 模块 | 文件 | 行数 | 测试文件 |
|---|---|---|---|
${modules.map((m) => { const l = loc(`src/modules/${m}`); return `| ${m} | ${l.files} | ${l.lines} | ${l.tests} |`; }).join('\n')}
| app（集成层） | ${loc('src/app').files} | ${loc('src/app').lines} | ${loc('src/app').tests} |

${modules.map((m) => `### ${m}\n\n\`\`\`text\n${exportsOf(`src/modules/${m}`)}\n\`\`\``).join('\n\n')}

## 4. 全局数据契约 \`src/types/schema.ts\`

\`\`\`typescript
${read('src/types/schema.ts')}
\`\`\`

## 5. 关键路径源码摘录

${critical.map(([title, file, fn]) => `### ${title} — \`${fn}\`\n\n\`\`\`typescript\n${extract(file, fn)}\n\`\`\``).join('\n\n')}

## 6. 集成层：Worker 池与 AI 动作执行

\`\`\`typescript
${read('src/app/bio-client.ts')}
\`\`\`

\`\`\`typescript
${extract('src/app/actions.ts', 'applyAIAction')}
\`\`\`
${evaluation ? `\n## 7. 功能与性能评测数据\n\n\`\`\`json\n${evaluation}\n\`\`\`\n` : ''}`;

writeFileSync(join(root, 'AUDIT_BUNDLE.md'), out);
console.log(`AUDIT_BUNDLE.md written (${(out.length / 1024).toFixed(0)} KB, ${out.split('\n').length} lines)`);
