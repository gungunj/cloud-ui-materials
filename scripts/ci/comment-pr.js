/**
 * 在 PR 上添加评论
 * CommonJS 版本，用于 github-script action
 */
module.exports = async ({ github, context }, prNumber, isMerged, jobIndex) => {
  const fs = require('fs');
  const path = require('path');
  
  const repoRoot = path.resolve(__dirname, '../../');
  
  if (!prNumber || isNaN(prNumber)) {
    console.log('⚠️ 无法找到 PR 编号，跳过评论');
    return;
  }

  const summary = fs.readFileSync(path.join(repoRoot, 'build_summary.txt'), 'utf8');
  const title = isMerged 
    ? `### 📦 PR 合并后构建产物 (Batch ${jobIndex})`
    : `### 📦 PR 构建产物预览 (Batch ${jobIndex})`;

  const emoji = isMerged ? '🎉' : '👀';
  
  // 读取 diff 描述（如果存在）
  let diffDescription = '';
  try {
    diffDescription = fs.readFileSync(path.join(repoRoot, 'diff_description.txt'), 'utf8');
  } catch (e) {
    // 忽略错误
  }
  
  let body = `${emoji} ${title}\n\n${summary}\n\n`;
  
  if (diffDescription) {
    body += `${diffDescription}\n\n`;
  }
  
  body += `[点击此处进入 Run 详情页下载 Artifacts](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})\n\n`;
  
  // 添加 Release 链接（如果已创建）
  if (isMerged) {
    try {
      const buildResults = JSON.parse(fs.readFileSync(path.join(repoRoot, 'build_results.json'), 'utf8'));
      const successfulBuilds = buildResults.filter(r => r.status === 'success');
      if (successfulBuilds.length > 0) {
        const releaseTag = `release-${context.sha.substring(0, 7)}-${new Date().toISOString().split('T')[0]}`;
        body += `[查看 GitHub Release](https://github.com/${context.repo.owner}/${context.repo.repo}/releases/tag/${releaseTag})\n\n`;
      }
    } catch (e) {
      // 忽略错误
    }
  }

  try {
    // 如果是合并后的 PR，更新 PR body 添加包链接
    if (isMerged) {
      try {
        const { data: currentPR } = await github.rest.pulls.get({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: prNumber
        });
        
        // 生成包链接部分
        let packageLinksSection = '\n\n## 📦 构建产物下载\n\n';
        try {
          const buildResults = JSON.parse(fs.readFileSync(path.join(repoRoot, 'build_results.json'), 'utf8'));
          const successfulBuilds = buildResults.filter(r => r.status === 'success');
          
          if (successfulBuilds.length > 0) {
            packageLinksSection += '### 成功构建的组件包\n\n';
            for (const result of successfulBuilds) {
              const downloadLink = result.downloadUrl || 
                `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}#artifacts`;
              packageLinksSection += `- ✅ **${result.name}@v${result.version}**\n`;
              packageLinksSection += `  - 包名: \`${result.zipName}\`\n`;
              packageLinksSection += `  - 大小: ${(result.zipSize / 1024).toFixed(2)} KB\n`;
              packageLinksSection += `  - [下载链接](${downloadLink})\n\n`;
            }
          }
        } catch (e) {
          console.warn(`⚠️ 读取构建结果失败: ${e.message}`);
        }
        
        // 更新 PR body
        let newBody = currentPR.body || '';
        
        // 如果已经有构建产物部分，替换它；否则追加
        const packageSectionRegex = /\n\n## 📦 构建产物下载\n\n[\s\S]*?(?=\n\n---|\n\n## |$)/;
        if (packageSectionRegex.test(newBody)) {
          newBody = newBody.replace(packageSectionRegex, packageLinksSection);
        } else {
          newBody += packageLinksSection;
        }
        
        await github.rest.pulls.update({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: prNumber,
          body: newBody
        });
        
        console.log(`✅ 已更新 PR #${prNumber} 的 body，添加包链接`);
      } catch (updateError) {
        console.warn(`⚠️ 更新 PR body 失败: ${updateError.message}，将添加评论作为备选`);
      }
    }
    
    // 添加评论
    await github.rest.issues.createComment({
      issue_number: prNumber,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: body
    });
    console.log(`✅ 已在 PR #${prNumber} 上添加评论 (${isMerged ? '合并后' : '预览'})`);
  } catch (error) {
    console.error(`❌ 评论失败: ${error.message}`);
    // 如果 PR 已关闭且无法评论，尝试在 commit 上评论
    if (isMerged && context.eventName === 'push') {
      console.log('尝试在 commit 上添加评论...');
      try {
        await github.rest.repos.createCommitComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          commit_sha: context.sha,
          body: body
        });
        console.log('✅ 已在 commit 上添加评论');
      } catch (commitError) {
        console.error(`❌ Commit 评论也失败: ${commitError.message}`);
      }
    }
  }
};

