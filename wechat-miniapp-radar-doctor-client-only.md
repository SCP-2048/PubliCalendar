# 小程序项目体检报告

- 项目路径：c:\Users\ss\OneDrive\Code\PubliCalendar\apps\client
- 项目类型：uni-app
- 健康评分：65
- 识别结果：uni-app

## 总结

### 需要立即处理 P0 风险

Doctor 识别为 uni-app，当前评分 65。报告中有 1 个高风险项，其中 1 个为 P0，优先方向是密钥暴露处置，再评估推荐资源作为替代或修复路径。

### 下一步

- 先处理 P0 风险，避免继续扩大安全或维护风险。
- 对照推荐资源验证迁移路线：uni-app ★36.1k+。
- 修复后重新运行 Doctor，确认评分和风险项下降。

## 文件检查

- package.json：已发现
- project.config.json：未发现
- app.json：未发现
- .gitignore：未发现

## 风险与建议

### 未发现小程序配置文件

- 等级：warning
- 优先级：P1
- 说明：未找到 project.config.json 或 app.json。
- 证据：
  - 文件检查：project.config.json 与 app.json 均未发现
- 建议：确认扫描路径是否为小程序项目根目录。

### 环境变量文件可能进入版本库

- 等级：danger
- 优先级：P0
- 说明：检测到 .env.cloudflare、.env.tencent，但 .gitignore 未覆盖这些文件。Doctor 不读取密钥内容，但这类文件可能包含 AppSecret、Token 或私钥。
- 证据：
  - 未忽略环境文件：.env.cloudflare
  - 未忽略环境文件：.env.tencent
  - .gitignore：未提供或未发现
- 建议：立即把对应 .env* 文件加入 .gitignore，并确认历史提交中没有泄露 AppSecret、Token 或私钥。


## 推荐资源

- [uni-app ★36.1k+](https://github.com/dcloudio/uni-app)
  - 状态：adopt；风险：low；维护：active
  - 推荐原因：已在项目依赖中识别到 @dcloudio/uni-app，可查看该资源的维护状态和适用场景。
  - 摘要：使用 Vue 语法开发小程序、H5、App的统一框架。作为框架方案，当前适合优先评估。
