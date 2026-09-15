# AI Agent 智能对话助手 - 需求拆解文档

## 产品概述

- **产品类型**: AI Agent 对话助手（纯前端工具类应用）
- **场景类型**: <scene_type>prototype-app</scene_type>
- **分类说明**: 用户原始诉求仅为“一个agent”，属高度模糊需求，按最常见理解规划为 **AI Agent 对话助手**（聊天式智能代理页面）。若用户实际想要其他形态的 agent（如任务编排、工作流自动化），需在后续交互中修正。
- **目标用户**: 希望通过对话方式获取 AI 回答的普通用户
- **核心价值**: 一个开箱即用的 AI Agent 对话界面，支持流式输出回答、多轮会话管理与历史记录保存
- **界面语言**: 中文
- **主题偏好**: 浅色
- **导航模式**: 无导航（单页对话工具）

---

## 页面结构总览

> **说明**: 单页应用，用户目标唯一 —— “与 Agent 对话”。会话列表、对话区、输入区围绕同一任务流，不拆分多页。

**页面文件**: `AgentChatPage.tsx`

| 区域 | 说明 |
|-----|------|
| 左栏·会话列表（窄） | 历史会话列表 + “新对话”按钮；无历史时显示空状态引导 |
| 主区·消息流 | 用户与 Agent 的对话消息流（用户气泡右对齐、Agent 回答左对齐带头像），Agent 回答流式逐字渲染，支持 Markdown 排版 |
| 主区·输入区（底部固定） | 多行文本输入框 + 发送按钮 + 停止生成按钮（生成中显示） |
| 快捷指令区 | 输入框上方展示 3-4 个快捷 prompt 示例（首次空会话时显示，点击填入输入框） |

---

## 页面布局建议

- **布局模式**: 控制台布局（左窄栏会话列表 + 右主区消息流），移动端降级为单栏（会话列表收进抽屉）
- **视觉重心**: 结果（消息流）—— 对话工具的核心是阅读 Agent 回答，输入区常驻底部固定
- **结果承载区**: 主区消息流；初始态为空会话引导语 + 快捷指令示例占位
- **源材料承载区**: 用户消息即输入材料，已自然存在于消息流中，与回答上下对照，无需独立源材料区

---

## 插件规划

| 插件实例名称 | 基于官方插件 | 业务用途 | 输出模式 | 所属页面 |
|------------|-----------|---------|---------|---------|
| agent-reply | `ai-text-generate` | 接收用户在对话中输入的消息（含当前会话上下文），流式输出 Agent 回答 | stream | AgentChatPage |

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| Agent 对话回答 | real-plugin | capabilityClient.callStream 调 agent-reply 实例，传入用户当前输入的消息及本会话已有对话内容，流式渲染回答文本 | 失败提示 (toast “插件暂不可用，请稍后重试”) |
| 会话历史记录 | local-persist | localStorage key=`__global_agent_conversations`，保存会话列表与消息，刷新后可恢复 | 首次进入为空状态 |
| 快捷指令示例 | demo-mock | 前端常量数组（3-4 条示例 prompt） | ✅ 本身就是静态示例 |
| 复制回答内容 | import-export | navigator.clipboard 写入选中消息文本，toast 反馈 | 无 |

> 注：Agent 回答链路为 real-plugin，**严禁**用本地拼接文案冒充 AI 回答；插件失败时仅提示，不降级 mock。

---

## 功能列表

- **页面/区块**: AgentChatPage（唯一页面）
  - **页面目标**: 让用户与 AI Agent 完成多轮流式对话，并管理会话历史
  - **功能点**:
    - **发送消息并流式接收回答**: 点击发送（或 Enter）后，用户气泡立即入列，Agent 回答区域逐字流式渲染（带打字光标动画），生成完成后落定为 Markdown 排版
    - **停止生成**: 生成过程中输入区显示“停止”按钮，点击中断流式输出，保留已生成的部分内容
    - **多会话管理（新建/切换/删除）**: 左栏“新对话”按钮创建新会话；点击列表项切换会话并恢复对应消息流；会话项支持删除（带确认）
    - **会话历史持久化**: 会话与消息写入 localStorage，刷新页面后自动恢复最近会话；异常数据 parse 失败时静默重置为空状态
    - **快捷指令**: 空会话时展示 3-4 个示例 prompt 卡片，点击填入输入框（不直接发送）
    - **复制回答**: Agent 消息 hover 显示复制按钮，复制纯文本到剪贴板并 toast 反馈
    - **生成中状态锁**: Agent 回答未完成时禁用发送按钮，避免并发请求

---

## 数据共享配置

| 存储键名 | 数据说明 | 使用页面 |
|---------|---------|---------|
| `__global_agent_conversations` | 全部会话及消息记录，类型为 `IConversation[]` | AgentChatPage |
| `__global_agent_currentConversationId` | 当前激活会话 id，类型为 `string` | AgentChatPage |

```ts
interface IMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  /** 流式生成中标记 */
  streaming?: boolean;
  createdAt: number;
}

interface IConversation {
  id: string;
  title: string; // 取首条用户消息前 20 字自动生成
  messages: IMessage[];
  updatedAt: number;
}
```

---

## 质量基线确认

- [x] 核心功能完整可用：发送 → 流式回答 → 会话管理 → 历史持久化，主链路无空壳 handler
- [x] 有基本的视觉层次：左右分栏、气泡区分角色、Agent 带 Markdown 排版
- [x] 交互有反馈：流式打字、停止按钮、复制 toast、删除确认
- [x] 边界状态有处理：空会话引导、插件失败 toast、localStorage 异常重置、生成中禁发

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Free Direction —— 无参考材料，从“AI Agent 对话助手”语义自主建立视觉语言
- **核心情绪 / 应用类型**: Tool（AI Agent 对话工作台）—— 精密、可信赖、有“机器在思考”的实感
- **独特记忆点**: Agent 回答前的等宽字体“思考时间线”（`▸ planning → tool:web_search → synthesizing`），像终端日志一样逐行亮起，让不可见的推理过程变成界面叙事

## 2. Art Direction

- **方向名**: 深空控制台
- **Design Style**: Minimal Dark + Terminal 终端感 —— Agent 是“正在工作的机器”，深色底降低长对话的视觉疲劳，终端等宽元素传递精密与过程可追溯
- **DNA 参数**: 圆角 subtle（`rounded-md` 输入与卡片 / `rounded-full` 气泡）；阴影 subtle（`shadow-sm`，靠 border 分层）；间距 standard（`gap-4 / p-6`）；字体方向：无衬线 + 等宽点缀；装饰手法：状态点的呼吸微光、消息流左侧 2px 时间线轨道
- **应用类型**: Tool —— 单列对话流为核心，右侧可挂 Agent 信息面板

## 3. Color System

**色彩关系**: 深空炭底 + 石墨卡片 + 电光青绿主色 + 同色相暗一档的 hover 反馈底
**配色设计理由**: bg 决定“控制室”氛围；card 比底亮 4% 形成安静层级；primary 电光青绿只出现在发送按钮、光标、思考时间线与运行状态点，是界面唯一的光源；text 保持高对比白灰，代码与状态用等宽字体 + primary
**主色推导**: 青绿是终端荧幕的经典色相，天然携带“机器运行中”的语义，饱和度 84% 保证深底上的激活感，同时不刺眼
**使用比例**: 60% 深色中性 / 30% 卡片与辅助灰 / 10% primary；严禁主按钮、边框、icon、链接同时用 primary

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(220 14% 8%) | 页面深空底 |
| card | `--card` | `bg-card` | hsl(220 12% 12%) | 消息卡、输入面板、结果容器 |
| text | `--foreground` | `text-foreground` | hsl(210 20% 92%) | 正文与标题 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(215 10% 58%) | 会话元信息、占位符 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(160 84% 45%) | 发送 CTA、运行态、思考时间线 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(220 20% 6%) | primary 上的深色文字 |
| accent | `--accent` | `bg-accent` | hsl(217 15% 16%) | hover 浅底、选中会话、Skeleton |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(210 16% 80%) | accent 上的文字与图标 |
| border | `--border` | `border-border` | hsl(217 12% 20%) | 输入框、卡片、会话项边界 |

**语义色提示**: 成功（任务完成）hsl(150 55% 45%)，bg `hsl(150 45% 12%)` / border `hsl(150 40% 28%)` / text `hsl(150 60% 60%)`；警告（工具超时重试）hsl(38 80% 55%)，bg `hsl(38 55% 12%)` / border `hsl(38 50% 28%)` / text `hsl(38 75% 62%)`；错误（任务失败）hsl(354 65% 58%)，bg `hsl(354 45% 12%)` / border `hsl(354 40% 28%)` / text `hsl(354 70% 66%)`。三者饱和度与 primary 对齐 ±15%，均配 `✓ / ! / ✕` 图标，不靠颜色单独表达

## 4. 字体与节奏

- **font-display**: Space Grotesk —— 标题与 Agent 名称，几何无衬线带机械感
- **font-body**: Noto Sans SC —— 中文对话正文清晰可读，长会话不累
- **font-mono**: IBM Plex Mono —— 思考时间线、工具调用名、token 计数
- **字号**: H1 text-2xl（工具场景标题克制）；消息正文 text-base；时间线与元信息 text-sm / text-xs
- **圆角**: subtle —— 用户气泡 `rounded-full rounded-br-md`，Agent 面板 `rounded-md`，输入框 `rounded-lg`，反差强化“人提问圆润、机器回答方正”的角色对比

## 5. 全局布局契约

- **Reference Layout Use**: 按需求结构推导
- **Page / Section Order**: 顶部品牌栏（Agent 名 + 模型徽标）→ 会话区（左侧会话 rail 收纳）→ 消息流（主区）→ 底部输入坞（Composer，含工具开关 chip）
- **Standard Content Zone**: `max-w-3xl mx-auto`（消息流）；输入坞同宽，与消息流左右对齐
- **Shell / Frame Alignment**: 同宽 —— 输入坞、消息流、空状态共享同一垂直轴线
- **Padding & Rhythm**: `px-4 md:px-6 py-4`，消息间距 `space-y-6`，8px 倍数节奏
- **Full-bleed Zones**: 仅会话 rail 与背景氛围光可全宽；所有文字内容受 Content Zone 约束
- **Local Narrowing**: 空状态引导文案可收窄至 `max-w-xl` 居中
- **Overflow Strategy**: 代码块与工具调用结果内 `overflow-x-auto`；引用来源横向 chip 列表 `overflow-x-auto`
- **Flexibility Boundary**: 允许移动端隐藏 rail 改抽屉、缩小消息间距；不允许切换 max-w、主色或圆角语言

## 6. 视觉与动效

- **装饰**: 思考时间线轨道（消息左侧 2px 竖线 + 逐行点亮的状态点）；背景一处 8% 透明度 primary 辐射微光
- **阴影/边界**: 轻 —— 靠 border 与明度差分层，仅输入坞用 `shadow-lg` 悬浮
- **动效**: 精致 —— Agent 思考时状态点呼吸（2s opacity 循环）；流式文字逐 token 淡入；工具调用行展开 `height` 过渡；所有 `:focus-visible` 用 primary 2px 外描边

## 7. 组件原则

- Composer：多行输入 + 发送 primary 按钮 + 工具 chip（联网 / 代码执行 / 文件）toggle 态用 accent 底 + primary 描边
- 消息组件三态：流式生成中（底部光标闪烁）/ 完成 / 失败可重试（错误语义色 + 重试按钮）
- 会话 rail 项：Default / Hover（accent）/ Active（左侧 2px primary 竖标 + accent 底）
- 加载与空状态延续终端语言（`▸ awaiting task…`），不回退默认 spinner

## 8. Image Direction

- **Image Role**: 无强制图片需求，优先通过排版、等宽状态时间线和 primary 微光建立视觉记忆点；空状态可用 2px 线框风格的小型 Agent 节点图形
- **Image Art Direction**: 若需品牌主视觉：深空底上由细线连接的发光节点网络，象征 Agent 工具编排图，非对称构图，光源来自节点本身的青绿辐射
- **Image Prompt Keywords**: dark interface, glowing node network, thin connecting lines, electric teal accents, asymmetric composition, subtle bloom, terminal aesthetic, minimal, high contrast, machine intelligence
- **Image Avoidance**: 避免拟人机器人插画、通用大脑发光图、蓝紫渐变科技海报感、3D 玻璃拟态小人

## 9. Anti-patterns

- **Split personality**: 会话页与空状态切换 max-w 或圆角语言；全站共享同一轴线与 subtle 圆角系统
- **Phantom tokens**: 编造不存在的 CSS 变量；语义色三态必须在主题中补齐
- **Default SaaS drift**: 回退到白底蓝按钮的通用聊天模板；本产品的身份是深空控制台 + 青绿光标
- **Invisible interaction**: 工具 chip 与会话项只做 hover 不做 focus-visible；键盘状态用 primary 外描边
- **Mono-hue tyranny**: primary 铺满 icon、边框、链接；把青绿收敛到 CTA、运行态与时间线三处
- **Status color drift**: 错误红饱和度 95% 刺穿深底；语义色饱和度对齐 primary 的 60%–90% 区间