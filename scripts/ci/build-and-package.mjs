#!/usr/bin/env node
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

const batchItemsPath = path.join(repoRoot, 'batch_items.json');
const items = JSON.parse(fs.readFileSync(batchItemsPath, 'utf8'));

let summary = '';
const buildResults = [];

for (const pkg of items) {
  console.log(`📦 正在尝试处理: ${pkg.name}`);
  try {
    // 读取 package.json 获取版本和路径信息
    const pkgJsonPath = path.join(repoRoot, pkg.relDir, 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const version = pkgJson.version || '0.0.0';
    const pkgDir = path.resolve(repoRoot, pkg.relDir);
    
    // 执行构建，使用 Turbo 的增量构建和缓存
    // --filter 只构建指定包及其依赖
    // --force 强制重新构建（如果需要）
    const turboFlags = process.env.TURBO_FORCE === 'true' ? '--force' : '';
    execSync(`turbo run build --filter=${pkg.name} ${turboFlags}`, { 
      stdio: 'inherit', 
      cwd: repoRoot,
      env: {
        ...process.env,
        // 启用 Turbo 远程缓存（如果配置了）
        ...(process.env.TURBO_TOKEN && {
          TURBO_TOKEN: process.env.TURBO_TOKEN,
          TURBO_TEAM: process.env.TURBO_TEAM || 'default'
        })
      }
    });

    const zipName = `${pkg.name.replace(/[@/]/g, '-')}-v${version}.zip`;
    const distPath = path.join(pkgDir, 'dist');
    if (!fs.existsSync(distPath)) {
      throw new Error('dist 目录不存在');
    }
    execSync(`zip -r ${zipName} dist/`, { cwd: pkgDir, stdio: 'inherit' });
    
    const artifactDir = path.join(repoRoot, 'upload_artifacts');
    if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
    fs.renameSync(path.join(pkgDir, zipName), path.join(artifactDir, zipName));
    
    buildResults.push({
      name: pkg.name,
      version: version,
      dir: pkgDir,
      relDir: pkg.relDir,
      zipName: zipName,
      status: 'success'
    });
    
    summary += `- ✅ ${pkg.name} (v${version})\n`;
  } catch (err) {
    console.warn(`⚠️ ${pkg.name} 构建失败（可能缺少私有依赖）`);
    summary += `- ❌ ${pkg.name} (失败)\n`;
    buildResults.push({
      name: pkg.name,
      status: 'failed',
      error: err.message
    });
  }
}

fs.writeFileSync(path.join(repoRoot, 'build_summary.txt'), summary);
fs.writeFileSync(path.join(repoRoot, 'build_results.json'), JSON.stringify(buildResults, null, 2));

console.log('✅ 构建和打包完成');

