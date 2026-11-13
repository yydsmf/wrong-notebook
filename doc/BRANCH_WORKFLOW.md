# 公开主线维护

`main` 仅包含可公开的应用源码、通用部署示例和开发文档。公开远程名为 `origin`，地址为 `https://github.com/yydsmf/wrong-notebook.git`。

`upstream` 指向 `https://github.com/margrop/wrong-notebook.git`，仅用于获取源项目更新，禁止向其推送。本地可设置 `git config remote.pushDefault origin` 和 `git config branch.main.pushRemote origin`，实际发布仍显式指定 `origin`。

私有部署文件、实际服务器配置和内部运维文档只存在于受限远程的部署分支。
私有分支从公开提交创建，后续仅将公开主线合入私有分支。禁止反向合并、直接推送私有提交或将私有分支标记为公开发布标签。

## 上传前检查

在每个工作副本启用钩子：

```bash
git config core.hooksPath .githooks
python3 scripts/check-public-history.py main
```

钩子在向 GitHub 上传任何分支或标签前，检查整个历史中的私有文件路径，以及固定公开基线之后的全部可达对象，包括已删除内容、合并父提交和标签说明。
检查会拒绝私有部署文件、实际内网地址、私有服务域名、本机提交邮箱和私钥。
已审阅的文档示例地址仅允许出现在指定示例文件中；新例外需要审阅。
浅克隆会拒绝检查。首次发布先确认源项目历史保留方案；如保留完整历史，从 `upstream` 补齐（`git fetch --unshallow upstream`），审阅上游更新，并在保护当前改动后完成整合。

固定公开基线为 `9751f074f713f55add71174ebe4066641ad370f4`，是首次加入私有部署信息之前的上游提交。此前的上游源码和历史保持原样；该检查不表示旧上游历史通过了完整密钥审计。缺少该基线或该基线不是待推送引用的祖先时，检查全部可达对象。

该检查用于阻止常见误推；本地钩子可被绕过，仍需审阅差异并使用密钥扫描工具检查公开历史。
GitHub Actions 是上传后的补充检查。发布前必须在本地或受限流水线完成检查。

## 发布

```bash
git switch main
git remote -v
git remote get-url origin
git status --short --branch --untracked-files=all
python3 scripts/check-public-history.py main
git push origin main
```

空仓库首次发布不执行 `git pull origin main`。首次推送成功后执行 `git fetch origin` 和 `git branch --set-upstream-to=origin/main main`，使本地主分支跟踪自己的公开仓库；后续同步前先审阅工作区和分支差异。

版本标签仅指向通过检查的公开提交，并显式推送到 `origin`。家庭部署分支的配置和操作流程保留在该私有分支。完整测试、日期标签和发布后验证步骤见 [版本发布指南](release-guide.md)。
