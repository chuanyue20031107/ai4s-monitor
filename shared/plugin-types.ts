// ---- plugin:agent_reply_1 ----
// ============================================================
// 插件 agent_reply_1 (AI Agent 对话助手回复) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface AgentReplyOneInput {
  /** 用户在对话中输入的最新消息 */
  user_message: string;
  /** 当前会话的历史上下文信息 */
  session_context?: string;
}

/**
 * capabilityClient.load('agent_reply_1').callStream<AgentReplyOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 AgentReplyOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface AgentReplyOneOutput {
  /** [object Object] */
  content: string;
  /** [object Object] */
  response?: string;
}
// ---- end:agent_reply_1 ----

// ---- plugin:ai4s_intelligence_crawler_1 ----
// ============================================================
// 插件 ai4s_intelligence_crawler_1 (AI4S 情报来源抓取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface Ai4sIntelligenceCrawlerOneInput {
  /** 来源页面 URL（支持 RSS 链接、会议页面或官网地址） */
  page_url: string;
}

/**
 * capabilityClient.load('ai4s_intelligence_crawler_1').callStream<Ai4sIntelligenceCrawlerOneOutput>('crawlWebPage', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 Ai4sIntelligenceCrawlerOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface Ai4sIntelligenceCrawlerOneOutput {
  /** [object Object] */
  content: string;
}
// ---- end:ai4s_intelligence_crawler_1 ----

// ---- plugin:ai4s_intelligence_article_structured_analysis_1 ----
// ============================================================
// 插件 ai4s_intelligence_article_structured_analysis_1 (AI4S情报文章结构化分析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface Ai4sIntelligenceArticleStructuredAnalysisOneInput {
  /** 情报文章正文内容 */
  article_content: string;
  /** 情报文章标题 */
  article_title: string;
}

/**
 * capabilityClient.load('ai4s_intelligence_article_structured_analysis_1').call<Ai4sIntelligenceArticleStructuredAnalysisOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { category, importance_score, importance_reason, ... } = result;
 * 返回值形如：
 *   {"category":"示例文本","importance_score":0,"importance_reason":"示例文本","content_type":"示例文本","moat_tags":"示例文本","chinese_summary":"示例文本"}
 */
export interface Ai4sIntelligenceArticleStructuredAnalysisOneOutput {
  /** 文章分类，只能从以下选项中选择一个：模型/数据/AI4S应用/自动化实验室/产业与商业/其他。分类优先级规则：1. 必须按文章的核心研究对象或核心贡献所属领域选主分类，即使文章同时涉及多个方向，也只能选最主要的一个，绝不能因为跨领域就归为其他。2. 涉及新模型发布、模型架构改进、模型能力评测、世界模型、智能体模型、大模型、生成式模型等内容归为「模型」；涉及数据集发布、数据基准、数据工程方法归为「数据」；涉及 AI 在科研领域的具体应用（如药物发现、材料设计、蛋白质结构预测、气候模拟等）归为「AI4S应用」；涉及实验室自动化、机器人实验、自动驾驶实验平台、高通量筛选归为「自动化实验室」；涉及融资、合作、商业化、产品发布、行业动态归为「产业与商业」。3. 「其他」仅用于完全不属于前五类的纯资讯快讯或行政通知类内容，严禁将跨多个研究方向的深度研究总览、博客综述、年度进展直接归为其他——必须从中判断其最核心的归属方向并归入对应分类。 */
  category: string;
  /** 文章重要性评分，1-5的整数，1最低，5最高 */
  importance_score: number;
  /** 中文重要性理由，说明给出该评分的原因 */
  importance_reason: string;
  /** 内容类型，只能从以下选项中选择：company_claim/paper_result/media_report */
  content_type: string;
  /** 护城河影响标签，从以下选项中多选并以逗号分隔：数据/模型/实验自动化/药物设计/材料发现/商业合作/人才 */
  moat_tags: string;
  /** 200字以内的中文摘要，概括文章核心内容 */
  chinese_summary: string;
}
// ---- end:ai4s_intelligence_article_structured_analysis_1 ----

// ---- plugin:ai4s_daily_intelligence_feishu_push_1 ----
// ============================================================
// 插件 ai4s_daily_intelligence_feishu_push_1 (AI4S每日情报飞书推送) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface Ai4sDailyIntelligenceFeishuPushOneInput {
  /** 接收人用户ID列表 */
  receiver_user_list?: string[];
  /** 接收群组chat_id列表 */
  receiver_group_list?: string[];
  /** 情报标题内容 */
  title_content: string;
  /** Markdown格式的摘要正文 */
  content: string;
}

/**
 * capabilityClient.load('ai4s_daily_intelligence_feishu_push_1').call<Ai4sDailyIntelligenceFeishuPushOneOutput>('send_feishu_message', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { success } = result;
 * 返回值形如：
 *   {"success":false}
 */
export interface Ai4sDailyIntelligenceFeishuPushOneOutput {
  /** [object Object] */
  success: boolean;
}
// ---- end:ai4s_daily_intelligence_feishu_push_1 ----

// ---- plugin:ai4s_daily_intelligence_group_create_1 ----
// ============================================================
// 插件 ai4s_daily_intelligence_group_create_1 (AI4S每日情报推送飞书群组创建) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface Ai4sDailyIntelligenceGroupCreateOneInput {
  /** 飞书群组名称，默认值为'AI4S 每日情报推送' */
  group_name?: string;
  /** 初始群成员用户ID列表 */
  member_list: string[];
}

/**
 * capabilityClient.load('ai4s_daily_intelligence_group_create_1').call<Ai4sDailyIntelligenceGroupCreateOneOutput>('createGroup', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { groupID } = result;
 * 返回值形如：
 *   {"groupID":"示例文本"}
 */
export interface Ai4sDailyIntelligenceGroupCreateOneOutput {
  /** [object Object] */
  groupID: string;
}
// ---- end:ai4s_daily_intelligence_group_create_1 ----