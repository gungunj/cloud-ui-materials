#!/usr/bin/env node
/**
 * 单独上传每个 zip 文件到 GitHub Artifacts，保持原始文件名
 * 注意：GitHub Actions 的 upload-artifact 会把多个文件打包成一个 zip
 * 如果需要保持原始文件名，建议从 GitHub Release 下载
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../");

const artifactDir = path.join(repoRoot, "upload_artifacts");

if (!fs.existsSync(artifactDir)) {
  console.log("⚠️ upload_artifacts 目录不存在");
  process.exit(0);
}

const zipFiles = fs
  .readdirSync(artifactDir)
  .filter((f) => f.endsWith(".zip"))
  .map((f) => path.join(artifactDir, f))
  .filter((f) => {
    try {
      const stats = fs.statSync(f);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  });

if (zipFiles.length === 0) {
  console.log("⚠️ 未找到 zip 文件");
  process.exit(0);
}

console.log(`📦 找到 ${zipFiles.length} 个 zip 文件`);
console.log("💡 提示：GitHub Artifacts 会把多个文件打包成一个 zip");
console.log("💡 如果需要保持原始文件名，请从 GitHub Release 下载");

// 列出所有文件
zipFiles.forEach((zipFile, index) => {
  const zipName = path.basename(zipFile);
  const stats = fs.statSync(zipFile);
  console.log(
    `  ${index + 1}. ${zipName} (${(stats.size / 1024).toFixed(2)} KB)`
  );
});

console.log("✅ 文件列表完成，将使用 batch upload 上传所有文件");
