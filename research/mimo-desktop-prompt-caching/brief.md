# Brief: Xiaomi MiMo Desktop 的 prompt caching 工程实现调研

## 调研问题
小米 MiMo Desktop（桌面 AI agent，2026-09 邀请制 Beta）在「提示词缓存命中（prompt caching / KV cache hit）」上有哪些公开可考的工程实现：请求组织、服务商缓存机制字段、消息历史结构、cached_tokens 展示、缓存失效规避策略。

## 子问题清单（可判定真伪）
1. MiMo Desktop 是闭源客户端（无公开源码仓库），还是存在可审计的开源实现（GitHub/HuggingFace）。
2. MiMo Desktop 对接的模型服务（自研 MiMo 模型云 API / 第三方服务商）是什么，请求端点与协议是否公开。
3. 其请求中是否使用或暴露 prompt caching 相关字段（如 Anthropic cache_control、OpenAI prompt_cache_key、DeepSeek 上下文缓存）。
4. system prompt / tools / messages 的组织方式（是否存在公开文档、抓包分析、逆向分析佐证）。
5. 消息历史是否 append-only、动态内容（时间戳/环境信息）位置。
6. 是否读取并展示 cached_tokens / 缓存命中率。
7. 小米自研 MiMo 模型推理侧（vLLM/自研引擎、API 服务）是否声明支持 context caching / KV cache 复用。
8. 相关替代证据：XiaomiMiMo 开源仓库（模型侧）是否有 KV cache 相关实现可佐证工程习惯。

## 预算档位
默认档（本 Agent 无 spawnAgent，取证直接执行；来源 ≤15）。

## 产出要求
结论先行的结构化中文报告，每条结论带来源 URL；查不到的维度如实标注「未找到公开证据」。
