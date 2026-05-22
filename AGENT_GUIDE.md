# Agent系统使用指南

## 功能概述

Agent系统是一个智能助手功能，可以帮助用户优化提示词、生成分镜脚本等。系统支持预设Agent和自定义Agent。

## 系统架构

### 前端组件
- **AgentSidebar**: 左侧滑出的侧边栏容器
- **AgentList**: 显示可用的智能体列表
- **AgentChat**: 与智能体的对话界面
- **状态管理**: 使用Zustand进行状态管理，支持IndexedDB持久化

### 后端API
- `GET /api/agents` - 获取所有智能体
- `GET /api/agents/:id` - 获取单个智能体
- `POST /api/agents` - 创建智能体
- `PUT /api/agents/:id` - 更新智能体
- `DELETE /api/agents/:id` - 删除智能体
- `POST /api/agents/:id/chat` - 与智能体对话

## 使用流程

### 1. 用户端使用

#### 打开Agent侧边栏
1. 在Flow页面的生成器栏中，点击"类型选择器"
2. 选择"Agent 模式"
3. 系统会自动打开左侧的Agent侧边栏，并根据当前模式（图片/视频）选择对应的Agent

#### 与Agent对话
1. 在Agent列表中选择一个智能体（如"提示词优化助手"）
2. 在输入框中输入你的需求，例如："一只猫"
3. Agent会返回优化后的提示词
4. 点击"应用到生成器"按钮，优化后的提示词会自动填充到生成器的输入框

#### 关闭侧边栏
- 点击侧边栏右上角的关闭按钮
- 或点击侧边栏右侧的收起按钮

### 2. 管理员端管理

#### 访问Agent管理页面
1. 登录管理后台 `/admin-login`
2. 在左侧菜单中选择"智能体管理"

#### 创建自定义Agent
1. 点击"添加智能体"按钮
2. 填写以下信息：
   - **名称**: 智能体的显示名称
   - **描述**: 功能描述，会显示在列表中
   - **类别**: 选择类别（提示词优化/分镜生成/通用助手/自定义）
   - **系统提示词**: 定义Agent的身份、功能和行为
   - **模型ID**: 使用的AI模型（如gpt-4）
   - **温度**: 控制输出的随机性（0-2）
   - **最大Token**: 限制输出长度
   - **缩略图URL**: 可选，显示在列表中的图标
   - **启用状态**: 是否在用户端显示
3. 点击"保存"

#### 编辑Agent
1. 在列表中找到要编辑的Agent
2. 点击"编辑"按钮
3. 修改信息后点击"保存"

#### 删除Agent
1. 在列表中找到要删除的Agent
2. 点击"删除"按钮
3. 确认删除

## 预设Agent

系统自动初始化了两个预设Agent：

### 1. 提示词优化助手
- **类别**: prompt-optimization
- **功能**: 优化图片生成提示词，添加视觉细节、专业术语和质量提升词
- **示例**:
  - 输入: "一只猫"
  - 输出: "一只优雅的波斯猫，坐在洒满阳光的窗台上，柔和的自然光线，温暖的色调，浅景深，电影级构图，高清细节，专业摄影"

### 2. 分镜脚本助手
- **类别**: storyboard
- **功能**: 根据故事创意生成详细的视频分镜脚本
- **示例**:
  - 输入: "一个人在森林中探险"
  - 输出: 包含3-8个镜头的详细分镜描述

## 技术细节

### 数据模型
```typescript
interface Agent {
  id: string;
  name: string;
  description: string;
  category: 'prompt-optimization' | 'storyboard' | 'general' | 'custom';
  type: 'preset' | 'custom';
  thumbnail?: string;
  systemPrompt: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}
```

### 对话流程
1. 用户输入消息
2. 前端将消息和对话历史发送到后端
3. 后端使用Agent的systemPrompt和用户配置的AI供应商调用API
4. 返回AI的回复
5. 前端显示回复，用户可以选择应用到生成器

### 数据持久化
- **前端**: 对话历史存储在IndexedDB中
- **后端**: Agent配置存储在`data/agents.json`文件中

## 扩展建议

1. **添加更多预设Agent**:
   - 风格转换助手
   - 色彩搭配顾问
   - 构图建议专家

2. **增强功能**:
   - 支持上传参考图到Agent对话
   - Agent可以直接触发生成任务
   - 多轮对话优化

3. **用户体验优化**:
   - 添加Agent使用教程
   - 显示Agent的使用统计
   - 支持收藏常用Agent

## 故障排查

### Agent侧边栏无法打开
- 检查后端服务是否正常运行
- 检查浏览器控制台是否有错误
- 确认至少有一个启用的Agent

### 对话无响应
- 检查AI供应商配置是否正确
- 确认API密钥有效
- 查看后端日志是否有错误

### Agent列表为空
- 访问管理后台检查Agent是否已创建
- 确认Agent的isActive状态为true
- 重启后端服务以初始化预设Agent
