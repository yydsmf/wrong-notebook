# 版本发布指南

本文档说明如何从公开 `main` 发布版本。公开仓库为 `yydsmf/wrong-notebook`，`origin` 必须指向 `https://github.com/yydsmf/wrong-notebook.git`。`upstream` 指向源项目 `https://github.com/margrop/wrong-notebook.git`，仅用于获取更新，禁止向其推送；私有部署分支不能用于公开发版。

## 版本标签策略

项目以发布日期作为版本号，分为两类：

| 类型 | 格式 | 示例 | 何时使用 |
| --- | --- | --- | --- |
| 预览版（默认） | `v年.月.日-n` | `v2026.11.13-1` | 日常发布；`n` 为当天第几次发布，从 1 开始 |
| 正式版 | `v年.月.日` | `v2026.11.13` | **须经维护者确认后才能打**，AI 代理不得自行创建或推送 |

- 预览版不会更新 Docker `latest`，npm 发布到 `next` 标签，GitHub Release 标记为预发布。
- 正式版会更新 Docker `latest` 和 npm `latest`，发布前确认对应提交的 CI（含 E2E）已通过。

- 月、日不补零：2026 年 1 月 5 日写作 `v2026.1.5`，不能写成 `v2026.01.05`（npm 版本号不允许前导零）。
- 版本号在构建镜像时由 Git 标签自动得出（环境变量 `APP_VERSION`），发版无需修改代码。设置页「关于」和 `/api/health` 显示该版本号（不含 `v`）。
  - 推送标签触发的构建使用标签本身的版本，如 `2026.11.13`。
  - 其他构建（`scripts/build-image.sh`、手动镜像构建）使用 `git describe` 的结果；标签之后还有提交时形如 `2026.11.13-3-gabc1234`。
  - 取不到标签时（本地开发、浅克隆）回退到 `package.json` 的 `version`，该字段无需随发版更新。

## 发布操作流程

### 1. 核对目录、远端与实际改动

在正式项目目录操作；本机目录边界见本地文件 `.git/info/RELEASE_LOCAL.md`（不入库）。

```bash
git remote -v
git remote get-url origin
git status --short --branch --untracked-files=all
git log -8 --oneline --decorate
git tag --sort=-version:refname | head -20
git diff --check
git diff
git diff --cached
```

确认分支为 `main`、远端地址正确，并检查未跟踪文件。存在上一发布标签时，使用 `git diff <上一个标签>` 检查从该版本至当前工作区的实际改动，不只看最新提交；标签序号同时核对 `origin`，防止与已发布版本冲突。

首次发布先确认是否保留源项目完整历史；如需保留，从 `upstream` 补齐完整历史，再在保护现有改动的前提下整合到最新历史。浅克隆不能通过公开历史检查。空 `origin` 尚无 `main` 时，不执行 `git pull origin main`。

### 2. 运行测试与构建

```bash
npm ci --no-audit --no-fund
npm run lint
npm test
npm run build
```

改动较大时追加 `npm run test:unit`、`npm run test:integration`，并按实际改动执行必要的 E2E 验证。测试或构建失败时先解决问题，不继续创建发布标签。

### 3. 正式版：更新 CHANGELOG.md

预览版跳过此步。正式版发布前，用 `scripts/changelog.sh` 把自上一个正式版以来的提交写入 [CHANGELOG.md](../CHANGELOG.md)，提交后再在该提交上打标签：

```bash
bash scripts/changelog.sh v2026.11.13
git add CHANGELOG.md
```

CHANGELOG.md 与 GitHub Release 说明使用同一脚本（`scripts/release-notes.sh`）按提交信息分类生成，每次运行都会整体重写，手动修改会被覆盖；因此提交信息应写成用户能看懂的改动说明。

需要专门说明的版本可提交 `doc/releases/<标签>.md`，Release 工作流优先使用该文件。首次定制版采用此方式，明确应用源码快照范围，避免将仅保留在历史中的上游功能列为本版本新增内容。

正式版还必须确认 CI、E2E 和构建全部成功，并取得用户明确授权后才能创建无后缀标签。需要先推送 `main` 以运行 CI 时，只推送 `origin main`，等待对应提交的检查通过后再创建正式标签。

### 4. 审阅暂存区并创建发布提交

按文件明确暂存本次公开改动，禁止无筛选执行 `git add .`。不得提交真实密钥、密码、Token、私钥、部署凭据、`.env` 或 `config/setup-token`；保留本地私有文件，不删除用户的未跟踪文件。

```bash
git diff --cached --name-status
git diff --cached
git diff --check
git diff --cached --check
# 确认暂存区后创建发布提交，版本取实际日期与下一个可用序号
git commit -m "Release v2026.11.13-1"
python3 scripts/check-public-history.py main
```

不得使用强制推送、硬重置或清理未跟踪文件绕过问题。不修改 `package.json` 版本号。

### 5. 创建版本标签

```bash
# 默认创建预览版标签（当天日期 + 序号）
git tag v2026.11.13-1

# 正式版标签须经维护者确认后再创建
git tag v2026.11.13

# 或指定提交创建标签
git tag v2026.11.13 <commit-sha>
```

### 6. 只推送 origin

```bash
python3 scripts/check-public-history.py v2026.11.13-1
git push origin main v2026.11.13-1
```

首次推送成功后，按 [公开主线维护](BRANCH_WORKFLOW.md) 将 `main` 跟踪分支切换为 `origin/main`。

`v*` 标签会触发 GitHub Release、Docker、npm 和各平台安装包等工作流。首次发布前检查 fork 的发布目标和权限：npm 包名及 Trusted Publishing 必须属于自己的发布配置，Android 发布包需要配置固定签名密钥，不可直接假设源项目的凭据和发布权限可继承。

本仓库默认构建 npm 离线包、桌面端和飞牛OS 安装包。真正发布到 npm 需先配置自己有权限的包名与 Trusted Publisher，再设置仓库变量 `NPM_PUBLISH_ENABLED=true`。发布已签名 Android 包需先配置安装包指南中的四项签名 secrets，再设置 `ANDROID_RELEASE_ENABLED=true`；未启用时跳过 Android，不阻塞其他附件上传。手动运行 Packages 仍可生成 Android 调试包。

首次发布后，GHCR 镜像默认为私有，需在 GitHub 的 Packages → wrong-notebook → Package settings 中改为 Public。

### 7. 验证远端引用和构建状态

```bash
git ls-remote origin refs/heads/main refs/tags/v2026.11.13-1
gh run list --repo yydsmf/wrong-notebook --limit 10
```

核对引用指向预期提交，并查看对应 GitHub Actions 的实际结果。仍处于 `queued` 或 `in_progress` 时只能说明已触发或正在执行，不能声称构建成功；失败时说明具体任务及原因。

## Windows 签名

Packages 工作流支持在 Windows 构建后、原有附件上传前接入 SignPath，配置步骤见 [WINDOWS_SIGNING.md](WINDOWS_SIGNING.md)。项目正在申请基金会授权，默认不启用；获批、配置完成并验证后才设置 `SIGNPATH_ENABLED=true`。

启用后每次签名都需维护者在 SignPath 人工批准。工作流等待并验证签名，成功后继续原有 Release 附件和校验和步骤；失败时停止，不回退到未签名包。不得为测试接入而重打已发布的正式标签或替换旧版附件。

## 自动生成的镜像标签

推送 `v2026.11.13` 标签后，CI 自动生成以下镜像标签：

| 标签 | 说明 |
|------|------|
| `2026.11.13` | 精确版本号 |
| `2026.11` | 当月最新版本 |
| `2026` | 当年最新版本 |
| `latest` | 最新版本 |
| `sha-xxxxxxx` | Git commit 短哈希 |

## 用户部署方式

```yaml
# docker-compose.yml
services:
  wrong-notebook:
    # 推荐：锁定精确版本
    image: ghcr.io/yydsmf/wrong-notebook:2026.11.13
    
    # 或：自动获取当月更新
    image: ghcr.io/yydsmf/wrong-notebook:2026.11
    
    # 不推荐：始终最新（生产环境慎用）
    image: ghcr.io/yydsmf/wrong-notebook:latest
```

## 常用命令

```bash
# 查看所有标签
git tag -l

# 删除本地标签
git tag -d v2026.11.13

# 查看标签对应的提交
git show v2026.11.13
```

不重打已发布标签，不为修复失败工作流覆盖远端历史；检查并修复后使用下一个可用预览版序号。
