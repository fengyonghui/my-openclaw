#!/bin/bash
# 检查 git 状态
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的变更，请先提交或暂存。"
  exit 1
fi

# 打 tag
git tag -a v0.1.0-manual-model-feature -m "Prepare for adding manual model entry feature"
echo "已成功打 tag: v0.1.0-manual-model-feature"
