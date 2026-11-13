#!/usr/bin/env bash
# 生成 GitHub Release 说明：列出从上一个版本标签到指定标签之间的 feat / fix / 其他提交。
# 预览版（带 - 后缀）与上一个任意版本标签比较；正式版与上一个正式版标签比较。
# 用法：bash scripts/release-notes.sh <标签> [<提交>]
# 标签尚未创建时（如发版前更新 CHANGELOG.md）用第二个参数指定该版本对应的提交，默认就是标签本身。
set -euo pipefail

tag=${1:?usage: release-notes.sh <tag> [<ref>]}
ref=${2:-$tag}

if [[ "$tag" == *-* ]]; then
    prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' "$ref^" 2>/dev/null || true)
else
    prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude 'v*-*' "$ref^" 2>/dev/null || true)
fi

if [[ -n "$prev" ]]; then
    range="$prev..$ref"
else
    range="$ref"
fi
echo "范围: $range" >&2

subjects=$(git log "$range" --pretty=format:"%s" --no-merges)

section() {
    local title=$1 lines=$2
    [[ -z "$lines" ]] && return 0
    echo "### $title"
    while IFS= read -r line; do
        echo "- $line"
    done <<< "$lines"
    echo
}

feats=$(grep -iE '^feat[:(]' <<< "$subjects" | sed -E 's/^feat(\([^)]*\))?: //' || true)
fixes=$(grep -iE '^fix[:(]' <<< "$subjects" | sed -E 's/^fix(\([^)]*\))?: //' || true)
# 不符合 conventional commit 格式的提交（排除合并、版本号与跳过 CI 的提交）
others=$(grep -viE '^(feat|fix|chore|ci|docs|style|refactor|perf|test|build)[:(]|^[Mm]erge |bump version|\[skip ci\]' <<< "$subjects" || true)

notes=$(section "✨ 新功能" "$feats"; section "🛠 修复" "$fixes"; section "📦 其他变更" "$others")
# 没有新功能和修复时，列出测试、文档、CI 等维护提交，避免说明为空
if [[ -z "$notes" ]]; then
    maintenance=$(grep -vE '^[Mm]erge |\[skip ci\]' <<< "$subjects" || true)
    notes=$(section "🧹 维护" "$maintenance")
fi
if [[ -z "$notes" ]]; then
    notes="- 无重大变更"
fi
echo "$notes"
if [[ -n "$prev" ]]; then
    echo
    echo "**完整变更**：https://github.com/yydsmf/wrong-notebook/compare/$prev...$tag"
fi
