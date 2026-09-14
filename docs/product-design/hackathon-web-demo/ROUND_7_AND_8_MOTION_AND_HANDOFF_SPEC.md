# ROUND 7 & 8: MOTION CHOREOGRAPHY & IMPLEMENTATION HANDOFF READINESS
## Cross-Question Deep Research for Zhihu (Hackathon Edition)
> **Author**: Senior AI Product Designer · Interaction Designer · Frontend Design Director  
> **Status**: Design Phase Complete (Awaiting User "DESIGN FROZEN" to start Code)

---

## 一、动效与微交互编排 (Motion & Interaction Choreography)

根据 **Emil Kowalski 的动画哲学**，动效的唯一目的是：
1. **解释系统状态的变化（State Indication）**；
2. **保持空间一致性（Spatial Consistency）**；
3. **消除白屏与等待焦虑（Perceived Performance）**。

坚决杜绝无意义的飘浮动画与长达 500ms 以上的迟缓过渡。

### 1. 关键转场编排矩阵 (Transition Choreography)

| 转场阶段 | 动效形式 | 技术实现与曲线 (GSAP / CSS / Motion) | 耗时 (ms) | 心理暗示 |
| :--- | :--- | :--- | :--- | :--- |
| **首屏输入回车** | 输入框微缩 `scale(0.98)` 并平滑升起至顶栏作为常驻标题 | `transform: translateY(-80px) scale(0.92)`, `cubic-bezier(0.16, 1, 0.3, 1)` | 240ms | “已锁定议题，准备进入深水区研究” |
| **置顶研报 0 秒直开** | 首页精选卡片瞬间原地放大（Shared Layout）撑开为主阅读台 | `layoutId="featured-dossier"`, `spring(stiffness: 140, damping: 18)` | 300ms | 0 延迟、无白屏，评委直达高潮 |
| **Assembly 骨架点亮** | 每一个 Aspect 节点就绪时，左侧条目淡入伴随 4px 下落 | `opacity: 0 -> 1`, `y: -4 -> 0`, `stagger: 0.06` | 180ms | 研报框架稳步搭建的踏实感 |
| **Radar 语料脉冲** | 右侧抓取到知乎问题时，高亮闪烁一次并平滑上推 | `clip-path: inset(0 0 0 0)`, `opacity: 0.2 -> 1` | 160ms | 真实语料正在被高频吞吐注入 |
| **证据抽屉滑出** | 右侧 420px 抽屉贴边滑入，主内容区轻微应用 `blur(2px)` | `transform: translateX(0)`, `filter: blur(2px)` | 220ms | 保持阅读当前行上下文，随时可合上 |

---

### 2. 键盘交互与快捷键系统 (Keyboard Ergonomics)

为了赋予产品像 **Linear / Raycast** 般的专业工具质感，我们内置极度顺手的键盘导航：

* `Enter`：在输入框内直接启动实时深度研究；
* `Esc`：无论何时，一键平滑关闭打开的【证据检视抽屉】；
* `J` / `K` 或 `↓` / `↑`：在研报阅读态下，快速在不同的争议焦点卡片之间跳跃，并自动聚焦对应证据；
* `E`：一键快速展开/收起当前聚焦议题切面的全部知乎原问题；
* `?` 或 `Cmd + /`：调出极简键盘快捷键浮窗。

---

### 3. 无障碍与 Reduced Motion 降级 (Accessibility)

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
当系统检测到 `prefers-reduced-motion` 时，所有位移和弹簧动画全部降级为瞬时切换或仅保留纯色阶变化，确保视觉敏感用户的舒适度。

---

## 二、工程实施交接方案 (Implementation Handoff Blueprint)

当用户明确发出 **“DESIGN FROZEN”** 指令后，前端实现将按照以下工业级标准无缝启动：

### 1. 推荐技术栈 (Frontend Tech Stack)
* **框架**：Next.js 14 / 15 (App Router) 或 Vite + React 18 / 19（根据演示轻量化需求选择）；
* **样式系统**：Tailwind CSS 3.4+（完整配置上面定义的 Design Tokens 与字体栈）；
* **动效引擎**：`framer-motion` (用于共享布局与弹簧微交互) + 纯 CSS 变量（用于高频 GPU 加速）；
* **图标库**：`lucide-react`（极度干净克制的线性图标）；
* **数据持久与 Mock**：静态内置置顶金牌研报 JSON 契约，支持真机 0 延迟秒开；同时保留 API Fetch 接口承接真实实时运行。

### 2. 目录骨架规划 (Proposed Directory Structure)
```text
src/
├── app/                  # 路由入口 (Home, Dossier)
├── components/
│   ├── hero/            # 首页 Hero 仪态中心与搜索框
│   ├── featured/        # 置顶真实研报极速卡片
│   ├── progress/        # 双轨装配推进器 (Blueprint + Radar Stream)
│   ├── dossier/         # 四层研报主体 (Verdict, Battleground, Landscape)
│   └── inspector/       # 证据检视侧滑抽屉
├── data/
│   └── featured-case.ts # 真实的 23 题 / 396 语料完整数据契约
├── styles/
│   └── tokens.css       # 象牙暖白、知乎蓝、墨色阶梯代币
└── lib/
    └── motion.ts        # Emil 动效参数预设与 Spring 曲线
```

---

## 三、最终评审核对清单 (Ready for Frozen)

| 阶段 | 交付物文档 | 状态 |
| :--- | :--- | :--- |
| **ROUND 1** | [PRODUCT_DESIGN_DIAGNOSIS.md](file:///Users/songshiyao/.gemini/antigravity/brain/f0a790ed-7586-4c5a-be36-5d74427b6064/PRODUCT_DESIGN_DIAGNOSIS.md) (定位、Aha、8大诊断) | ✅ 已完成 |
| **ROUND 2** | [ROUND_2_DESIGN_DIRECTIONS_AND_IA.md](file:///Users/songshiyao/.gemini/antigravity/brain/f0a790ed-7586-4c5a-be36-5d74427b6064/ROUND_2_DESIGN_DIRECTIONS_AND_IA.md) (三大方向取舍、混合方案) | ✅ 已完成 |
| **ROUND 3 & 4** | [ROUND_3_AND_4_WIREFRAMES_AND_STATES.md](file:///Users/songshiyao/.gemini/antigravity/brain/f0a790ed-7586-4c5a-be36-5d74427b6064/ROUND_3_AND_4_WIREFRAMES_AND_STATES.md) (状态机与完整线框图) | ✅ 已完成 |
| **ROUND 5 & 6** | [ROUND_5_AND_6_DESIGN_SYSTEM_AND_DATA_SPEC.md](file:///Users/songshiyao/.gemini/antigravity/brain/f0a790ed-7586-4c5a-be36-5d74427b6064/ROUND_5_AND_6_DESIGN_SYSTEM_AND_DATA_SPEC.md) (设计系统与数据契约) | ✅ 已完成 |
| **ROUND 7 & 8** | [ROUND_7_AND_8_MOTION_AND_HANDOFF_SPEC.md](file:///Users/songshiyao/.gemini/antigravity/brain/f0a790ed-7586-4c5a-be36-5d74427b6064/ROUND_7_AND_8_MOTION_AND_HANDOFF_SPEC.md) (动效编排与实施交接就绪) | ✅ 已完成 |

---

### 下一步指令：
此时设计体系已全链路闭环完备。  
**只需你在对话中确认或输入：`DESIGN FROZEN`，我们将立刻转入代码实现阶段！**
