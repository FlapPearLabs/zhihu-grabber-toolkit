# CrossZhihu Web Demo · 知乎跨议题深度研报

> **Hackathon Edition · Apple-Grade Fluid UI & Editorial Design**  
> 不向单一问题要和稀泥的摘要，向整个知乎要经得起检验的共识、分歧与真实论据。

---

## 🎯 产品核心叙事与价值

本项目针对知乎 Hackathon 打造，彻底跳出传统“ChatGPT 聊天套壳”与“单一问题搜索汇总（Perplexity 模式）”的窠臼：

* **跨议题穿透 (Cross-Question Synthesis)**：一个复杂议题（如《AI 编程工具真的会取代程序员吗？》），系统自动解构出研发效能、用人市场、事故责任、架构理解等多个维度，拉取 20+ 个不同视角的知乎原问题；
* **共识与分歧制图 (Consensus & Contradictions)**：不是和稀泥的“有人说好有人说坏”，而是旗帜鲜明地摆出**全网强共识**与**尖锐行业冲突**（裁减论 vs 扩编论/杰文斯悖论）；
* **证据血统追溯 (Evidence Lineage & Audit)**：点击任何核心结论，一键展开**原汁原味的知乎答主原话、认证身份（如大厂技术总监、创业合伙人）与高赞引用**；
* **诚实透明边界 (Honesty Boundary)**：100% 语料分析覆盖度声明（完整分析了选定的 396 篇真实回答，绝不虚夸“知乎全量穷尽”）。

---

## 🍎 设计语言与人机工程 (Design Engineering)

本 Web Demo 严格遵循 **Apple WWDC 流体界面（Designing Fluid Interfaces）** 与 **Emil Kowalski 设计工程准则**：

1. **彻底去“AI 味”**：
   - 杜绝传统 AI 落地页的居中模板与大词行话；
   - 摒弃“万物皆卡片套卡片”的视觉噪音，采用 Apple News / 备忘录的典雅排版、细腻单线与呼吸感留白；
   - 文本全部回归真实人类语言。
2. **Apple 材质与触觉反馈**：
   - 顶栏采用 Apple 标志性的亚克力毛玻璃悬浮条（`backdrop-filter: blur(20px)`）；
   - 所有按钮与卡片遵循 Emil 的触觉按压标准：`:active` 触发 `scale(0.97)` 即时反馈；
   - 顶部视图切换内嵌 iOS 风格的实体滑动胶囊控制器（Sliding Pill Indicator）。
3. **原生 Sheet 证据检视抽屉**：
   - 采用类似 iPadOS Slide Over 的贴边抽屉设计；
   - 严格的空间一致性（右侧滑入，右侧滑出），支持全局按 `Esc` 键或点击遮罩撤回。

---

## 🚀 本地极速预览与体验

本 Demo 为纯自包含设计（Zero-dependency HTML + Tailwind CSS runtime），无需复杂的 Node 打包编译：

### 方式一：直接在浏览器中双击打开
```bash
open web-demo/index.html
```

### 方式二：通过静态服务器打开
```bash
npx serve web-demo
# 或
python3 -m http.server 3000 --directory web-demo
```
打开 `http://localhost:3000` 即可体验。

---

## 📂 完整设计文档归档

系统级设计推演、信息架构与动效编排文档存放在：
* [`docs/product-design/hackathon-web-demo/PRODUCT_DESIGN_DIAGNOSIS.md`](../docs/product-design/hackathon-web-demo/PRODUCT_DESIGN_DIAGNOSIS.md)
* [`docs/product-design/hackathon-web-demo/ROUND_2_DESIGN_DIRECTIONS_AND_IA.md`](../docs/product-design/hackathon-web-demo/ROUND_2_DESIGN_DIRECTIONS_AND_IA.md)
* [`docs/product-design/hackathon-web-demo/ROUND_3_AND_4_WIREFRAMES_AND_STATES.md`](../docs/product-design/hackathon-web-demo/ROUND_3_AND_4_WIREFRAMES_AND_STATES.md)
* [`docs/product-design/hackathon-web-demo/ROUND_5_AND_6_DESIGN_SYSTEM_AND_DATA_SPEC.md`](../docs/product-design/hackathon-web-demo/ROUND_5_AND_6_DESIGN_SYSTEM_AND_DATA_SPEC.md)
* [`docs/product-design/hackathon-web-demo/ROUND_7_AND_8_MOTION_AND_HANDOFF_SPEC.md`](../docs/product-design/hackathon-web-demo/ROUND_7_AND_8_MOTION_AND_HANDOFF_SPEC.md)
