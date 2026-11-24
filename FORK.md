# 本 fork 的维护方式

仓库：[sjgfa/cc-desk-tunnel](https://github.com/sjgfa/cc-desk-tunnel)。上游：[sun168567/cc-desk-tunnel](https://github.com/sun168567/cc-desk-tunnel)。保留原项目历史、许可和署名。

## 分支和当前基线

- `main`：保留 fork 创建时的上游主分支，后续可同步上游。
- `custom/stable`：维护本 fork 的 macOS 原生服务适配和客户端修复，当前基于正式版 `v0.3.19`，协议 29。
- `windows-client`：Windows 端维护的客户端分支。历史恢复和暂停同步后继续聊天的补丁已合入 `custom/stable`，旧版验证记录见 [Windows 维护说明](FORK-MAINTENANCE.md)。
- `origin`：本 fork；`upstream`：原项目。日常改动推送到 `origin`。

上游主分支可能包含尚未正式发布的改动。升级采用明确的正式版本标签，避免只点 GitHub 的 Sync fork 就以为定制分支和部署已经完成升级。

## 本 fork 的改动

1. macOS 原生服务：PTY 正常退出或强制关闭时清理进程组；服务端设备标识识别为 macOS；SSH ControlPath 按 macOS 套接字长度限制处理；平台错误提示及回归测试。
2. 客户端停止状态：实时会话更新立即生效，历史加载失败不会丢失停止状态；晚到的历史页不会用旧状态覆盖实时更新。包含历史失败、初始历史和更早历史页的回归测试。
3. 慢速链路：大图片在实时发送时穿插心跳，SSH 传输按接收确认控制发送量，文件和命令分开复用连接。
4. macOS 原生服务仅开放客户端设备的文件面板，服务自身的文件需要受限的 SFTP 实现。
5. 运行配置、证书、令牌、Claude 登录和会话数据不属于本仓库。


## 下次合并上游正式版

先克隆本 fork 到开发目录，或在现有检出中建立独立 worktree。不要在正在运行服务的源码目录中直接尝试合并和安装依赖。

下面的 `v0.3.N` 是占位符，替换为实际发布标签：

```sh
git fetch origin
git fetch upstream --tags
git worktree add -b upgrade/v0.3.N ../cc-desk-tunnel-v0.3.N origin/custom/stable
cd ../cc-desk-tunnel-v0.3.N
git merge --no-ff v0.3.N
```

Git 会保留双方提交历史并合并兼容的改动。同一区域有冲突时，逐项处理后再提交；若上游已有等价修复，移除不再需要的本地实现并保留相应回归检查，不重复叠加。

在新目录安装依赖并验证：

```sh
npm ci
npm run check
npm run typecheck
npm test
npm run build
git diff --check
git push -u origin upgrade/v0.3.N
```

macOS ARM64 安装依赖后若 `node-pty` 的辅助程序缺少执行权限，可执行：

```sh
chmod u+x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

通过验证后，将升级分支合入 `custom/stable` 并推送。部署仍是单独步骤：备份配置和数据库，确认正在运行的任务可中断，生成同版本网页资源和客户端，再切换服务、验证 TLS、SSH、终端和历史完整性。不要移动或重建上游版本标签。

Windows 端也需要按相同的正式版本更新 `windows-client` 并验证打包。两个分支的协议版本及共同客户端修复应保持一致；本 fork 不会自动合并或覆盖另一端尚未检查的提交。

## Windows 客户端

源码合并和推送不会修改电脑上已安装的程序。Windows 客户端需要从含修复的定制提交重新打包并安装；使用原项目的官方安装包会覆盖本地客户端修复，直到上游正式纳入这些修复。

仓库保留原有 Windows 打包工作流和脚本，具体见 `.github/workflows/package.yml` 及 `scripts/package-windows.mjs`。本次创建 fork 不触发发版，也不启动自动部署。
