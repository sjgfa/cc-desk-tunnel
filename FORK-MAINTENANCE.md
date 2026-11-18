# Windows 客户端维护

此 Fork 的 `windows-client` 分支保存客户端本地修复，`main` 保留上游代码。
`origin` 指向此 Fork，`upstream` 指向 `sun168567/cc-desk-tunnel`。

当前客户端基于官方 v0.3.16（`8127b58efaaca490d58a9188aebb5107249961a8`），
增加历史加载期间的停止状态修复及三项回归测试。未提高版本号；生成的安装包不是官方发行版。
不要再次套用旧版 v0.3.14 历史超时补丁。

## 合并下一版

先检查工作区，提交或妥善保存已有修改。使用 Windows x64 和 Node.js 24。

```powershell
git status --short
git switch windows-client
git fetch upstream --tags
# 将下行的 vX.Y.Z 替换为已确认与服务端兼容的正式版本标签。
git merge vX.Y.Z
```

发生冲突时检查上游实现是否已包含同等修复，保留正确行为及回归覆盖；不要盲目选择一边。
尚未确认合并结果时不要推送或安装。不要自动追随未发布的 upstream/main。

```powershell
npm ci
npm run typecheck
node --test apps/desktop/test-main/client.test.mjs
npm run build
git diff --check
# 新环境需先运行 npm run prepare:windows:package。
npm run package:windows
git push origin windows-client
```

打包命令还会执行 Windows 安装包启动检查，安装包位于 `artifacts/windows/`。
检查全部客户端窗口和 ccdt 执行通道，确认没有运行中的任务后再退出、备份用户配置并安装。
不要卸载清理用户数据。仅合并源码不会更新已安装客户端。

## v0.3.16 本机验证

- 类型检查、格式检查、生产构建通过。
- 客户端测试 28 项通过，包括历史失败、初始历史晚到、早期历史页晚到三项停止状态回归测试。
- Windows 安装包启动检查通过；安装后的 app.asar 与测试产物 SHA-256 一致。
- 实际连接恢复，原会话历史加载完成，显示用户停止，停止按钮及运行标记消失。
- 并发历史读取的竞态由回归测试验证，未通过真实模型任务再次制造竞态。

连接凭据、用户配置、会话数据及安装包均不提交到 Git。
