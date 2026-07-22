# Prompt 00 - Review and Improve CLAUDE.md

## Goal

在 Claude Code 通过 `/init` 自动生成初版 `CLAUDE.md` 后，对其进行人工审阅，并补充项目所需的工程协作规范。

## Context

Claude Code 已通过 `/init` 生成初版 `CLAUDE.md`。

初版已经包含项目背景和基础说明，但缺少以下内容：

- Git 提交规范
- 核心 Prompt 记录规范
- AI 协作边界
- TypeScript 与代码风格要求
- 规格驱动开发流程

因此没有重新生成文档，而是要求 Claude 保留已有内容并增量完善。

## Prompt

Please improve the current CLAUDE.md.

Keep all existing content.

Please add the following sections:

1. Git Workflow
- Commit after every meaningful milestone
- Use conventional commit messages:
  docs:, feat:, fix:, refactor:, test:
- Avoid huge commits

2. Prompt Recording
- Record every important prompt in prompts/
- Each record should include:
  Goal
  Input
  Output
  Result

3. AI Collaboration Rules
- Read PRD/SDD/DDD/TDD before implementing features
- Explain important design decisions
- Prefer incremental implementation
- Never overwrite user-written code without explanation

4. Coding Style
- TypeScript strict mode
- Small focused functions
- Separate frontend/backend responsibilities
- Prefer readable code over clever code

5. Spec-driven Development Workflow

PRD
↓
SDD
↓
DDD
↓
TDD
↓
Implementation
↓
Testing

Do not remove or rewrite existing content.
Only append and improve the document.

## Output Summary

Claude 保留了原有内容，并补充了：

- Git Workflow
- Prompt Recording
- AI Collaboration Rules
- Coding Style
- Spec-driven Development Workflow

## Result

接受修改后的文档。

该版本能够作为后续 Claude Code 开发过程中的项目级行为规范，并明确要求 AI 在实现前读取设计文档、采用增量开发方式并记录关键 Prompt。

## Reflection

本次 Prompt 明确限定了“保留已有内容，只做增量完善”，避免 Claude 大范围重写初始化文档。

不足之处是 Prompt Recording 最初只要求记录 Goal、Input、Output、Result，后续可进一步扩展为 Context、Decision 和 Reflection，以更完整地体现人工审阅过程。