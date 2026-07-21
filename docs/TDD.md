# AI Panel Studio - Test Driven Development Document


# 1. 测试目标

通过测试保证：

- 核心业务流程正确
- Agent调度逻辑稳定
- 数据隔离正确
- 前后端通信正常


# 2. 单元测试(Unit Test)


## 2.1 Discussion Manager

测试：

### 创建讨论

输入：

主题：
"新能源汽车未来发展"

专家数量：
4


预期：

- 创建成功
- 返回 discussion_id
- 数据保存到数据库


## 2.2 Expert Generator

测试：

输入：

讨论主题

专家数量


预期：

生成：

- 主持人
- 指定数量专家

每个专家包含：

- name
- title
- position
- color


## 2.3 Agent State Machine


测试状态转换：


IDLE

↓

THINKING

↓

READY

↓

SPEAKING

↓

COOLDOWN


预期：

状态转换符合规则。


非法状态转换：

应该被拒绝。


## 2.4 Message Manager


测试：

创建消息


输入：

speaker

content


预期：

保存成功。

关联正确 discussion_id。


# 3. API测试


## 创建讨论接口


POST /api/discussions


测试：

正常输入

错误输入

空主题


预期：

返回正确状态。


## 获取讨论接口


GET /api/discussions/:id


预期：

返回对应讨论数据。

不同讨论不能互相读取。


# 4. 实时通信测试


测试：

SSE/WebSocket连接。


验证：

- 新消息能够推送
- 专家状态能够更新
- 共识变化能够更新


# 5. E2E测试


模拟真实用户流程：


1.

打开首页


2.

创建讨论


3.

输入主题


4.

生成专家


5.

确认嘉宾


6.

进入演播厅


7.

观察实时讨论


8.

查看共识和分歧


9.

结束讨论


10.

查看总结



预期：

完整流程成功。


# 6. 测试优先级


P0:

- 创建讨论
- AI角色生成
- Transcript显示
- 数据隔离


P1:

- 专家状态
- 共识分析
- 实时更新


P2:

- UI细节
- 动画效果
