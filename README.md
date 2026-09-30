# dsh-quota

DeepSeek Harness Desktop 的额度监控插件。界面包括侧边栏的「额度看板」主页面，以及对话输入区底部的额度缩略按钮和点击后展开的小窗。后台定期查询余额与订阅用量，查询失败时保留上次成功结果并标明状态。

## 支持的连接

- 订阅用量：Codex、Claude、GitHub Copilot、Kimi Coding、MiniMax、Moonshot AI、OpenCode Zen、Z.AI 等已实现的 `pi-usage` 服务商。
- API 余额：DeepSeek、OpenRouter、Vercel AI Gateway、Moonshot AI 等服务商的余额接口。
- 中转站：为连接填写服务地址后，自动探测 New API 与 Sub2API 的余额接口。探测结果会在本次运行期间复用。

插件自动发现 Harness 中 `llm-pi-ai/<provider>` 格式且有对应查询适配器的凭据记录。其他连接可在「额度看板 → 添加连接」中配置服务商 ID、凭据引用名称和服务地址。凭据引用（如 `DEEPSEEK_API_KEY`）须先在 Harness 凭据设置、启动环境或 `.env` 中配置；表单不接收密钥值。Host 查询服务商，浏览器界面只接收账户名称、余额、状态和更新时间。

不同服务商开放的余额与用量字段不同。订阅可能只有时间窗百分比，API Key 可能只有金额；服务商不提供查询接口、授权过期或接口返回错误时会显示查询状态。自动发现的账户被「移除监控」后转为暂停，已有 Harness 凭据不受影响。

## 构建与安装

要求 Node.js `^22.19 || >=24`、pnpm，以及兼容 `0.2.0-rc.2` 的 DeepSeek Harness Desktop。

```powershell
cd D:\Code\dsh-quota
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
pnpm pack
```

首次启动 Desktop 以初始化 `desktop` profile，然后**完全退出**应用。在 Desktop 自带的 `dsh.cmd` 所在目录执行以下命令，或将该目录加入 `PATH` 后执行：

```powershell
dsh plugin --profile desktop add file:D:/Code/dsh-quota/dsh-quota-0.1.0.tgz
```

重新打开 Desktop 后，侧边栏出现「额度看板」，对话底部出现额度缩略按钮。修改源码后重新构建、更新版本号、重新打包安装，再重启 Desktop。开发中也可用 `file:D:/Code/dsh-quota` 安装本地目录。

插件后台默认每 5 分钟查询一次，每个请求 15 秒超时，最多 4 个并发请求。可以在 bundle 配置的 `dsh-quota` 行设置 `intervalMinutes`、`requestTimeoutMs`、`maxConcurrent`、`alertPercent` 和 `lowBalance`。账户独立的提醒阈值在主页面的「监控设置」中修改。账户列表和阈值保存在 Harness 的 `dsh_quota` storage domain，不保存密钥。

## 开发与来源

余额接口及解析逻辑参考并移植自 `D:\Code\pi-usage`（MIT），客户端界面依据已评审的主页面和小窗静态 HTML 设计稿实现。

测试使用本地模拟服务商响应，不发起真实余额请求。实际服务商的授权和接口可用性需在有对应账户的 Desktop 中验证。
