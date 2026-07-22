# Prompt 01 - Project Design Review

**Stage:** Day 2 - Design Review

---

## Goal

在正式开始编码前，对项目的设计文档进行一次完整的技术评审（Design Review），验证需求、架构、领域模型和测试策略是否完整，并制定可执行的开发路线，避免后续返工。

---

## Context

项目已完成以下规格文档：

- PRD.md
- SDD.md
- DDD.md
- TDD.md
- ACCEPTANCE_CRITERIA.md
- CLAUDE.md

在进入代码实现之前，希望 Claude 作为 Technical Lead 阅读全部设计文档，进行一次跨文档分析，而不是简单总结内容。

目标不是生成代码，而是发现设计缺口、识别潜在风险，并输出正式的设计评审文档。

---

## Prompt

Read the following project documents first:

- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- docs/ACCEPTANCE_CRITERIA.md
- CLAUDE.md

Do NOT write any implementation code.

Act as the technical lead of this project.

Your task is to perform a design review before implementation.

Please produce a document at:

docs/project-analysis.md

The document should include:

# 1. Product Goal
Summarize the product vision, MVP scope, target users and core user workflow.

# 2. System Architecture Review
Summarize the system architecture, module responsibilities, data flow, API boundaries and real-time communication design.

# 3. Domain Model Review
Review whether the current domain model is complete.
Point out any missing entities, relationships or potential future extensions.

# 4. Test Strategy Review
Review whether TDD.md sufficiently covers:

- Unit Tests
- API Tests
- Real-time (SSE/WebSocket) Tests
- Integration Tests
- E2E Tests

Identify any missing test scenarios.

# 5. Development Plan

Based on the current documents, propose a practical implementation roadmap.

Split the roadmap into milestones.

For each milestone provide:

- Goal
- Deliverables
- Risks
- Suggested Git Commit

Do not generate any application code.

Write the output to:

docs/project-analysis.md

---

## Output Summary

Claude 阅读了全部设计文档，并生成了 `docs/project-analysis.md`。

主要输出包括：

- Product Goal Review
- System Architecture Review
- Domain Model Review
- Test Strategy Review
- Development Plan

同时提出了大量具有工程价值的改进建议，例如：

- Discussion 生命周期状态设计
- Expert Role、Status 等缺失字段
- Message Type 区分公开消息与系统事件
- Summary Version 设计
- API 生命周期补充
- SSE 优于 WebSocket 的 MVP 建议
- SQLite 并发风险分析
- LLM Context Window 管理策略
- Integration Test 补充建议
- 六阶段 Milestone 开发路线

整个分析结果约两万余字，属于真正的 Design Review，而非文档摘要。

---

## Result

接受生成结果。

`docs/project-analysis.md` 被作为正式设计评审文档加入项目。

后续开发将以其中提出的 Milestone 作为主要开发路线。

---

## Reflection

这是项目第一次真正意义上的跨文档推理任务。

相比前一天生成 PRD、SDD、DDD 等单一文档，本次 Prompt 要求 Claude：

- 阅读全部设计文档
- 建立统一上下文
- 识别设计缺口
- 给出架构建议
- 制定开发计划

因此：

- 推理时间约 2 分 30 秒
- Token 消耗超过一万
- 输出质量明显高于普通文档生成

实践证明，在正式编码前增加一次 Design Review，可以提前发现领域模型、接口设计、测试覆盖和工程规划中的问题，能够有效降低后续返工成本。

这类 Prompt 更接近真实软件工程中的 Architecture Review，而不是普通的 AI 内容生成。