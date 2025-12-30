/**
 * 查找 PR 编号（用于合并后的 PR）
 * CommonJS 版本，用于 github-script action
 */
module.exports = async ({ github, context, core }) => {
  // 方法1: 从 commit message 中提取 PR 编号（GitHub 标准合并格式）
  const commitMessage = context.payload.head_commit?.message || '';
  let prMatch = commitMessage.match(/Merge pull request #(\d+)/);

  if (prMatch) {
    core.setOutput('pr_number', prMatch[1]);
    console.log(`✅ 从 commit message 找到 PR #${prMatch[1]}`);
    return;
  }

  // 方法2: 通过关联的 PR 查找（使用 commits API）
  try {
    const { data: commit } = await github.rest.repos.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.sha
    });
    
    // 检查 commit message
    prMatch = commit.commit.message.match(/Merge pull request #(\d+)/);
    if (prMatch) {
      core.setOutput('pr_number', prMatch[1]);
      console.log(`✅ 从 commit API 找到 PR #${prMatch[1]}`);
      return;
    }
    
    // 方法3: 通过关联的 PRs API 查找
    const { data: prs } = await github.rest.pulls.list({
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'all',
      base: context.ref.replace('refs/heads/', ''),
      sort: 'updated',
      direction: 'desc',
      per_page: 5
    });
    
    // 查找最近合并的 PR
    const mergedPR = prs.find(pr => pr.merged_at && pr.merge_commit_sha === context.sha);
    if (mergedPR) {
      core.setOutput('pr_number', mergedPR.number.toString());
      console.log(`✅ 通过 PRs API 找到 PR #${mergedPR.number}`);
      return;
    }
    
    // 方法4: 查找最近合并的 PR（通过时间判断）
    const recentMerged = prs.find(pr => pr.merged_at);
    if (recentMerged) {
      const mergeTime = new Date(recentMerged.merged_at);
      const commitTime = new Date(commit.commit.committer.date);
      // 如果合并时间在提交时间前后 1 分钟内，认为是同一个 PR
      if (Math.abs(mergeTime - commitTime) < 60000) {
        core.setOutput('pr_number', recentMerged.number.toString());
        console.log(`✅ 通过时间匹配找到 PR #${recentMerged.number}`);
        return;
      }
    }
    
    console.log('⚠️ 无法找到对应的 PR，将跳过评论');
  } catch (error) {
    console.log(`⚠️ 查找 PR 时出错: ${error.message}`);
  }
};

