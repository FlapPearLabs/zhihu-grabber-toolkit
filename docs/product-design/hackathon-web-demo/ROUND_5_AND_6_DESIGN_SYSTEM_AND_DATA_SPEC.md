# ROUND 5 & 6: DESIGN SYSTEM, HIGH-FIDELITY SPECS & DATA CONTRACT
## Cross-Question Deep Research for Zhihu (Hackathon Edition)
> **Author**: Senior AI Product Designer · Interaction Designer · Frontend Design Director  
> **Status**: Design Phase (Strictly No Code / Design First)

---

## 一、设计系统代币 (Design System Tokens)

本系统坚持 **“The Living Editorial Dossier”** 哲学：严肃、克制、典雅、高度可信。

### 1. 调色板代币 (Color Tokens)

```css
:root {
  /* 基础纸质底色 (Paper Surfaces) */
  --surface-base: #FAF9F6;        /* 象牙暖白，模拟优质出版物纸质，消除刺眼纯白 */
  --surface-subtle: #F3F1ED;      /* 微深次级表面，用于输入框、卡片槽底 */
  --surface-card: #FFFFFF;        /* 纯白卡片悬浮层 */
  --surface-overlay: rgba(255, 255, 255, 0.85); /* 磨砂玻璃态浮层 */

  /* 墨水阶梯 (Ink Hierarchy) */
  --ink-primary: #121417;        /* 绝非纯黑，而是带深邃微蓝的高密度石墨墨色 */
  --ink-secondary: #4A515E;      /* 次级阅读文本，舒适行距下具备最高辨识度 */
  --ink-tertiary: #7D8799;       /* 元数据、时间戳、辅助说明小字 */
  --ink-border: #E5E2DC;         /* 极细 1px 分割线，克制而硬朗 */
  --ink-border-strong: #C8C3BA;  /* 聚焦状态或强调边框 */

  /* 认知语义色彩 (Cognitive Semantics) */
  --semantic-zhihu: #0066FF;     /* 知乎智性蓝：用于品牌锚点、穿透高亮、外链 */
  --semantic-zhihu-subtle: rgba(0, 102, 255, 0.08);
  
  --semantic-consensus: #1B8754; /* 强共识绿：沉稳松针绿，非刺眼荧光绿 */
  --semantic-consensus-bg: rgba(27, 135, 84, 0.08);
  
  --semantic-conflict: #D9383A;  /* 观点交锋赤红：警示与张力 */
  --semantic-conflict-bg: rgba(217, 56, 58, 0.08);

  --semantic-condition: #D97706; /* 条件性成立琥珀橙 */
  --semantic-condition-bg: rgba(217, 119, 6, 0.08);
}

/* 深色模式适配 (Dark Dossier Mode) - 备选 */
[data-theme="dark"] {
  --surface-base: #0E1013;
  --surface-subtle: #16181D;
  --surface-card: #1D2128;
  --ink-primary: #F0F2F5;
  --ink-secondary: #9DA5B4;
  --ink-tertiary: #606877;
  --ink-border: #2B303B;
  --semantic-zhihu: #3385FF;
}
```

---

### 2. 排版字阶 (Typography Scale)

| 角色 | 字体家族 (Font Family) | 字号 / 行高 | 字重 | 用途 |
| :--- | :--- | :--- | :--- | :--- |
| **Display Hero** | `Newsreader`, `Source Han Serif SC`, serif | 36px / 1.25 | 600 (Semi-bold) | 首页大标题、研报核心裁决 |
| **Section Header** | `Inter`, `PingFang SC`, sans-serif | 20px / 1.35 | 600 | 研报四大分段标题、争议对撞焦点 |
| **Body Reading** | `Inter`, `PingFang SC`, sans-serif | 16px / 1.75 | 400 (Regular) | 研报主体段落，严控行长与呼吸感 |
| **Claim Heavy** | `Inter`, `PingFang SC`, sans-serif | 15px / 1.5 | 500 (Medium) | 正反方争论卡片中的核心论点 |
| **Metadata / Mono**| `JetBrains Mono`, monospace | 12px / 1.4 | 500 | 语料覆盖率、答主赞同数、知乎问题计数 |

---

### 3. Emil Kowalski 动效曲线代币 (Motion Tokens)

严格遵循 **Emil Kowalski 的动画工程哲学**：
* 绝不使用模糊漫长的 `transition: all 300ms`；
* 绝不在键盘输入等高频事件上加阻尼动画；
* 进场动画必须指定明确的 `transform-origin` 并从 `scale(0.96)` 启动，严禁从 `scale(0)` 突兀蹦出。

```css
:root {
  /* 极速交互 (按钮按压反馈、Tab切换) */
  --ease-instant: cubic-bezier(0.23, 1, 0.32, 1);
  --duration-instant: 140ms;

  /* 结构进场 (卡片展开、抽屉滑出) */
  --ease-dossier: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-dossier: 220ms;

  /* 柔和过渡 (背景遮罩模糊) */
  --duration-backdrop: 200ms;
}
```

---

## 二、核心组件解剖与交互规范 (Component Anatomy)

### 1. 【争议对撞双子卡】(The Contradiction Duel Card)
* **设计意图**：将传统 AI 和稀泥的长文，解构成具有视觉对冲张力的正反方答辩席。
* **左栏（裁减派/激进观点）**：
  * 顶部标红小徽标：`⚔️ 替代论 (38% 样本支撑)`
  * 核心论点文本：字号 15px，Medium，行高 1.5
  * 底部证据胶囊：内嵌知乎答主身份标签（如：`某大厂研发总监 · 3.4k赞`）与引用标记 `[1]`
* **右栏（扩张派/防御观点）**：
  * 顶部标绿小徽标：`🛡️ 扩编论 (52% 样本支撑)`
  * 核心论点文本：字号 15px，Medium，行高 1.5
  * 底部证据胶囊：内嵌知乎答主身份标签（如：`资深架构师 · 2.8k赞`）与引用标记 `[2]`
* **交互反馈**：鼠标悬停在左栏时，右栏自然降暗（`opacity: 0.65`），当前栏边框微亮（`border-color: var(--semantic-conflict)`），凸显对焦感。

---

### 2. 【证据检视抽屉】(The Evidence Inspector Drawer)
* **触发机制**：点击报告内任何角标 `[1]`, `[2]` 或点击关联知乎原题。
* **桌面端布局**：固定在视口右侧，宽 `420px`，高度 100vh，无缝贴边。
* **内容层级**：
  1. **标题区**：证据编号与对应 Claim 的提炼；
  2. **溯源知乎问题**：知乎原题直链（带 External Link 图标，点击在新标签打开）；
  3. **答主语境卡片**：知乎头像缩略、认证名、获赞数、回答年份（突出 2023 vs 2025 时间跨度）；
  4. **黄金原汁原味引文**：带有双引号的高亮引用框，字号 14px，背景为 `var(--surface-subtle)`；
  5. **关联旁证**：展示另外 2 个同样支持该论点的知乎回答片段。

---

## 三、精选真实案例数据结构规范 (Mock Data Contract)

为了确保后续前端工程无缝接入并完美演示置顶研报，我们定义清晰的 TypeScript / JSON Schema 数据契约：

```typescript
export interface ResearchDossier {
  id: string;
  topic: string;
  verdict: {
    heroStatement: string; // 核心裁决一句话
    takeaways: Array<{
      tag: "共识" | "分歧" | "条件" | "盲区";
      title: string;
      description: string;
    }>;
  };
  metrics: {
    totalQuestionsDiscovered: number; // 发现问题数: 23
    selectedCorpusCount: number;      // 纳入语料数: 396
    analyzedCorpusCount: number;      // 分析完成数: 396
    coveragePercentage: 100;          // 选定语料覆盖率
    aspectsCount: number;             // 切面数: 4
  };
  contradictions: Array<{
    id: string;
    battleTopic: string; // 争议焦点标题
    perspectiveA: {
      stance: string;    // 立场名称
      summary: string;   // 论点总结
      shareRatio: string;// 占答主比例，如 "38%"
      citations: number[]; // 引用编号，如 [1, 2]
    };
    perspectiveB: {
      stance: string;
      summary: string;
      shareRatio: string;
      citations: number[];
    };
  }>;
  aspects: Array<{
    id: string;
    title: string;       // 如 "真实研发效能实测与技术债踩坑"
    questionCount: number;
    corpusCount: number;
    zhihuQuestions: Array<{
      questionId: string;
      title: string;
      topAnswerAuthor: string;
      authorBadge: string;
      votes: number;
      answerYear: number;
    }>;
  }>;
  evidences: Record<number, {
    citationId: number;
    claimSummary: string;
    zhihuQuestionTitle: string;
    zhihuUrl: string;
    authorName: string;
    authorTitle: string;
    voteCount: number;
    year: number;
    highlightQuote: string;
    crossReferences: Array<{ question: string; votes: number }>;
  }>;
}
```

---

## 四、阶段总结与进入下一轮

至此，**ROUND 5 (Design System)** 与 **ROUND 6 (High-Fidelity UI & Contract)** 已完全固化。

下一步我们将直接推进 **ROUND 7 (Motion & Choreography 动效编排)**，详细规划 GSAP 与 Framer Motion 在页面各个状态切换时的微交互参数！
