# AI Panel Studio - Software Design Document

## 1. 系统架构概述

AI Panel Studio 采用前后端分离架构。

整体结构：

用户
 |
Web Frontend
 |
Backend API Server
 |
AI Agent System
 |
Large Language Model API

同时：

Backend Server
 |
SQLite Database


## 2. 技术选型

### Frontend

技术：

- React
- TypeScript
- Vite

职责：

- 页面展示
- 用户交互
- 讨论状态展示
- Transcript 实时更新


### Backend

技术：

- Node.js
- Express

职责：

- API 接口
- 业务逻辑
- AI Agent 调度
- 数据管理


### Database

技术：

- SQLite

存储：

- 讨论信息
- 专家信息
- 发言记录
- 共识与分歧


### AI Model

模型：

DeepSeek V4 Pro

调用方式：

Backend Server 调用大模型 API。

API Key：

仅保存在后端环境变量。


## 3. 系统模块设计

### 3.1 Discussion Manager

负责：

- 创建讨论
- 管理讨论状态
- 隔离不同讨论数据


### 3.2 Expert Generator

负责：

根据用户输入：

- 讨论主题
- 专家数量

生成：

- 主持人
- 专家角色


专家数据包括：

- Name
- Title
- Position
- Color


### 3.3 Round Table Engine

负责：

模拟圆桌讨论流程。

包括：

- 主持人控制流程
- 专家上下文理解
- 专家自主参与
- 发言顺序管理


### 3.4 Transcript Manager

负责：

保存和推送：

- 发言人
- 内容
- 时间
- 角色信息


### 3.5 Consensus Analyzer

负责：

根据当前讨论内容生成：

- 共识
- 分歧

并持续更新。


## 4. 数据模型设计

### Discussion

字段：

id

title

status

created_at


### Expert

字段：

id

discussion_id

name

title

position

color


### Message

字段：

id

discussion_id

speaker_id

content

created_at


### Summary

字段：

id

discussion_id

consensus

disagreement


## 5. API设计

### 创建讨论

POST /api/discussions


输入：

{
 topic,
 expert_count
}


返回：

discussion_id


---

### 获取讨论信息

GET /api/discussions/:id


返回：

讨论基本信息。


---

### 生成专家

POST /api/discussions/:id/experts


返回：

专家列表。


---

### 获取Transcript

GET /api/discussions/:id/messages


返回：

当前讨论记录。


---

### 实时事件

使用：

SSE / WebSocket


推送：

- 新消息
- 专家状态
- 共识变化


## 6. 数据流设计


用户创建讨论

↓

Backend 创建 Discussion

↓

调用 AI Model

↓

生成专家阵容

↓

用户确认

↓

启动 Round Table Engine

↓

专家 Agent 生成消息

↓

保存 SQLite

↓

SSE 推送前端

↓

页面实时更新


## 7. 安全设计

- API Key 不进入前端
- 使用环境变量保存
- 后端统一调用模型


## 8. MVP开发顺序

Phase 1:

完成基础项目结构。


Phase 2:

完成数据库。


Phase 3:

完成讨论创建和专家生成。


Phase 4:

完成实时讨论。


Phase 5:

完成总结与优化。


---

## 9. AI Agent 状态设计

### 9.1 Agent角色

系统包含两类 Agent：

### Host Agent

职责：

- 控制讨论流程
- 提出问题
- 引导深入讨论
- 总结观点


### Expert Agent

职责：

- 根据自身角色参与讨论
- 表达观点
- 补充其他专家
- 质疑或反驳观点


## 9.2 Expert状态

每个 Expert Agent 具有以下状态：

### IDLE

等待状态。

表示当前专家没有参与意愿。


### THINKING

正在根据：

- 当前讨论内容
- 自身立场
- 其他专家观点

判断是否需要参与。


### READY

专家决定参与。

等待调度。


### SPEAKING

正在输出观点。


### COOLDOWN

刚完成发言，暂时避免连续输出。


## 9.3 发言决策流程


收到新的讨论消息

↓

所有 Expert Agent 分析上下文

↓

判断：

是否有新的观点？

是否需要补充？

是否需要反驳？

是否与自身领域相关？

↓

部分 Agent 进入 READY

↓

Round Table Engine 选择下一位发言者

↓

Agent SPEAKING

↓

保存 Message

↓

返回 COOLDOWN


## 9.4 发言调度原则

系统不采用固定轮流模式。

选择因素包括：

- 与当前话题相关程度
- 对已有观点的补充价值
- 与自身立场一致程度
- 是否产生新的视角


## 9.5 Chain-of-Thought限制

系统只展示：

- 当前状态
- 公开关注点
- 简短摘要


禁止展示：

- 完整思维链
- 内部推理过程


## 9.6 事件流设计

Backend通过事件流向Frontend发送：

### Expert状态事件

example:

expert_status_update


内容：

{
 expert_id,
 status
}


### 新消息事件

example:

message_created


内容：

{
 speaker,
 content,
 timestamp
}


### 共识更新事件

example:

consensus_updated


内容：

{
 consensus,
 disagreement
}