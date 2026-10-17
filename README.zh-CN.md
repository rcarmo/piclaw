# PiClaw — 自托管 AI 工作区

![PiClaw](docs/icon-256.png)

语言：[English](README.md) · **简体中文** · [日本語](README.ja.md)

PiClaw 是基于 [Pi Coding Agent](https://github.com/earendil-works/pi) 构建的自托管 AI 工作区，默认采用单用户模式。你可以在同一个浏览器窗口中与智能体协作、编辑文件、运行命令并查看结果。再次访问时，对话、文件和计划任务仍会保留；模型请求会发送到你配置的服务，包括兼容 OpenAI API 的本地服务器。

Web UI 支持英语、简体中文和日语，并提供桌面和移动端布局。使用容器、虚拟机或专用机器，限制智能体能够访问的文件和服务。

![演示动画](docs/demo.gif)

## 安装

| 方式 | 用途 |
|---|---|
| [Docker](#使用-docker-快速开始) | 推荐的部署方式；包含 Bun、PiClaw 和配套命令行工具 |
| [便携发行包](docs/getting-started.md#portable-releases) | 无需 Docker，可用于 Linux、Apple Silicon Mac，以及实验性的 Windows 部署；包含 Bun 和运行时依赖 |
| [通过 Bun 从仓库安装](docs/install-from-repo.md) | 使用已有的 Bun 安装指定发布标签，属于实验性方式 |
| [源码构建](docs/development.md) | 开发和本地测试 |

发行包可从 [GitHub Releases](https://github.com/rcarmo/piclaw/releases) 下载，容器镜像位于 [GHCR](https://github.com/rcarmo/piclaw/pkgs/container/piclaw)。固定发布标签可重复部署相同版本。

### 使用 Docker 快速开始

你需要 Docker，以及模型提供商的凭据或可访问的本地模型服务器。模型服务在启动后配置。

> [!WARNING]
> 新实例默认不要求 Web 登录。以下命令**仅向 localhost 发布端口**。配置认证期间，请保持实例不对外开放。任何能够访问未受保护实例的人，都可以使用智能体的文件和工具。

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

1. 在 Docker 主机上打开 [http://localhost:8080](http://localhost:8080)。
2. 在聊天中发送 `/login`，配置**模型提供商**。这与浏览器登录是两回事。PiClaw 复用 Pi 的提供商凭据，无需在 Docker 命令中填写 API 密钥。
3. 使用 `/model` 选择模型，然后试试：“在工作区创建一个 Markdown 检查清单，并向我展示文件。”
4. 允许其他机器访问前，请[设置浏览器认证](docs/getting-started.md#secure-browser-access)和 HTTPS。

`./home` 和 `./workspace` 都保存持久数据。替换容器时请保留这两个目录；**绝不要通过删除 `workspace/.piclaw/store/messages.db` 来重置或升级 PiClaw**。请参阅[首次运行检查、备份和升级](docs/getting-started.md)。

## 可以完成的任务

| 任务 | 核心内置功能 |
|---|---|
| 与智能体协作 | 流式聊天、模型选择、运行中调整指令、排队追加消息、独立对话和 `/btw` 旁支提问 |
| 处理文件 | 工作区文件浏览器、上传、CodeMirror 编辑器、shell 工具和可分离的 xterm.js 终端 |
| 查看结果 | CSV/TSV 表格、PDF、图片、视频和代码查看器，以及 VNC 远程显示面板 |
| 下次访问时继续工作 | 计划任务、可搜索的聊天历史和基于文件的 [Dream 记忆](docs/dream-memory.md) |
| 扩展工作流 | 技能、[MCP 服务器](docs/mcp.md)、浏览器自动化、图像处理、Adaptive Cards 和交互式可视化内容 |

[Web UI 指南](docs/web-ui.md#chat-and-status-surfaces)和[工具与技能参考](docs/tools-and-skills.md)介绍界面操作和命令。本地模型配置见 [llama.cpp](docs/llama-cpp.md)；Azure 图像生成需要[配置 Azure OpenAI/Foundry](docs/azure/azure-openai-extension.md)。

[可选插件](https://rcarmo.github.io/piclaw-addons/)提供 Draw.io、Office 文档渲染和工具、看板、其他终端渲染器、Windows 桌面自动化、Proxmox、Portainer、Microsoft 365 和配对实例间的消息传递。请通过[设置与插件](docs/settings-and-addons.md)单独安装。

## 安全与限制

- **默认采用单用户模式。** [实验性家庭模式](docs/multi-user/README.md)是面向小型用户组的可信多用户模式。已提升的 `family-shared` 部署提供各自拥有的对话，但共享同一个工作区和进程，不提供文件系统隔离。隔离容器模式不可用。另请参阅[家庭模式用户指南](docs/multi-user/user-guide.md)。
- 智能体以运行进程的用户权限执行操作。原生安装可访问该用户的文件和命令；容器可访问挂载的文件及其网络配置允许访问的资源。请使用专用环境，只挂载你打算共享的内容。
- 浏览器认证支持身份验证器验证码（TOTP）和通行密钥。保持后端不对外开放，远程访问使用 HTTPS，并且只信任已配置的[反向代理](docs/reverse-proxy.md)发送的转发头。
- 自托管将应用状态保存在你的机器上。云端模型和外部工具仍会收到你发送给它们的数据。可选的[钥匙串](docs/keychain.md)需要主密钥，但不会加密整个工作区或聊天历史。

- 启用运行时锁后，任何现有锁路径（包括过期或格式错误的记录）都会阻止启动。崩溃后可能需要先进行[离线管理员清理](docs/multi-user/operator-recovery.md#existing-runtime-locks)才能启动或维护；只要锁的所有者可能仍在运行，就不要删除锁。

## 文档

以下详细文档为英文：

- [入门指南](docs/getting-started.md) — 安装、首次聊天、认证、数据持久化和升级
- [配置](docs/configuration.md) — 设置、路径、模型提供商、SSH 工具和环境覆盖
- [Web UI](docs/web-ui.md#chat-and-status-surfaces) — 聊天、工作区、编辑器、终端和查看器
- [文档索引](docs/README.md) — 运维、集成、开发和架构

## 贡献

工作项和缺陷报告在 **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)** 中跟踪。

- [提交工作项或缺陷报告](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [提问](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [查看项目看板](https://github.com/users/rcarmo/projects/13)

报告问题时请使用 issue 模板。修改代码前，请阅读[开发文档](docs/development.md)和[仓库工作流](AGENTS.md)，并通过拉取请求提交修改。

## 鸣谢

- [pi.dev](http://pi.dev)，提供 PiClaw 使用的 Pi 核心
- [rcarmo/vibes](https://github.com/rcarmo/vibes) — PiClaw 的原始 UX 设计
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [earendil-works/pi](https://github.com/earendil-works/pi)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — Tobi Lutke 和 David Cortés 开发的自主实验循环（现由 `rcarmo/piclaw-addons` 中的 autoresearch 插件提供）
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — Nico Bailon 的可视化内容生成技能理念、提示词工作流和模板模式（经过改编，未直接随包分发原项目）

> [!NOTE]
> PiClaw 与 [pi.dev](https://pi.dev) **没有直接隶属关系**。它是基于 Pi 核心的衍生作品，增加了自己的运行时、工具和 UI 层。

## 许可证

[MIT](LICENSE)
