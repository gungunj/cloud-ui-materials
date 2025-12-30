#!/usr/bin/env node
import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../");

const batchItemsPath = path.join(repoRoot, "batch_items.json");
const items = JSON.parse(fs.readFileSync(batchItemsPath, "utf8"));

let summary = "";
const buildResults = [];
let successCount = 0;
let failCount = 0;

for (const pkg of items) {
  console.log(`📦 正在尝试处理: ${pkg.name}`);
  try {
    // 读取 package.json 获取版本和路径信息
    const pkgJsonPath = path.join(repoRoot, pkg.relDir, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const version = pkgJson.version || "0.0.0";
    const pkgDir = path.resolve(repoRoot, pkg.relDir);

    // 确保该包的依赖已安装（如果 node_modules 缺失）
    const nodeModulesPath = path.join(pkgDir, "node_modules");
    if (!fs.existsSync(nodeModulesPath)) {
      console.log(`⚠️ ${pkg.name} 的 node_modules 缺失，尝试安装依赖...`);
      try {
        // 尝试在该包目录安装依赖
        execSync("pnpm install --prefer-offline", {
          cwd: pkgDir,
          stdio: "inherit",
          env: { ...process.env, CI: "true" },
        });
      } catch (installErr) {
        console.warn(
          `⚠️ ${pkg.name} 依赖安装失败，继续尝试构建: ${installErr.message}`
        );
      }
    }

    // 执行构建，使用 Turbo 的增量构建和缓存
    // --filter 只构建指定包及其依赖
    let buildSucceeded = false;
    let turboExitCode = 0;
    let buildAttempts = 0;
    const maxAttempts = 2; // 最多尝试2次：第一次正常构建，如果失败则强制重新构建

    while (buildAttempts < maxAttempts && !buildSucceeded) {
      buildAttempts++;
      const isForceBuild = buildAttempts > 1;
      const turboFlags = isForceBuild ? "--force" : "";

      try {
        console.log(
          `🔨 构建尝试 ${buildAttempts}/${maxAttempts}${
            isForceBuild ? " (强制重新构建)" : ""
          }...`
        );
        execSync(`turbo run build --filter=${pkg.name} ${turboFlags}`, {
          stdio: "inherit",
          cwd: repoRoot,
          env: {
            ...process.env,
            // 启用 Turbo 远程缓存（如果配置了）
            ...(process.env.TURBO_TOKEN && {
              TURBO_TOKEN: process.env.TURBO_TOKEN,
              TURBO_TEAM: process.env.TURBO_TEAM || "default",
            }),
          },
        });
        buildSucceeded = true;
        turboExitCode = 0;
        console.log(`✅ Turbo 构建命令成功`);
      } catch (turboErr) {
        // Turbo 命令失败，记录退出码
        turboExitCode = turboErr.status || turboErr.code || 1;
        if (buildAttempts < maxAttempts) {
          console.warn(
            `⚠️ Turbo 构建命令失败（退出码: ${turboExitCode}），将尝试强制重新构建...`
          );
        } else {
          console.warn(
            `⚠️ Turbo 构建命令最终失败（退出码: ${turboExitCode}），继续检查构建产物...`
          );
        }
        buildSucceeded = false;
      }
    }

    // 验证构建产物：检查常见的输出目录
    const possibleOutputDirs = [
      "dist",
      "dist-theme",
      "lib",
      "es",
      "esm",
      "types",
    ];
    let foundOutputDir = null;
    let outputDirPath = null;

    for (const dir of possibleOutputDirs) {
      const dirPath = path.join(pkgDir, dir);
      if (fs.existsSync(dirPath)) {
        // 检查目录是否有内容（不是空目录）
        try {
          const files = fs.readdirSync(dirPath);
          if (files.length > 0) {
            foundOutputDir = dir;
            outputDirPath = dirPath;
            break;
          }
        } catch (e) {
          // 忽略读取错误
        }
      }
    }

    if (!foundOutputDir) {
      // 构建产物不存在，尝试直接运行构建命令（绕过 Turbo）
      console.warn(
        `⚠️ 未找到构建产物，尝试直接运行构建命令（绕过 Turbo 缓存）...`
      );

      try {
        // 尝试直接运行 package.json 中的 build 命令
        const buildScript = pkgJson.scripts?.build;
        if (buildScript) {
          console.log(`🔨 直接运行构建命令: ${buildScript}`);
          execSync(buildScript, {
            cwd: pkgDir,
            stdio: "inherit",
            env: { ...process.env, NODE_ENV: "production" },
          });

          // 再次检查输出目录
          for (const dir of possibleOutputDirs) {
            const dirPath = path.join(pkgDir, dir);
            if (fs.existsSync(dirPath)) {
              try {
                const files = fs.readdirSync(dirPath);
                if (files.length > 0) {
                  foundOutputDir = dir;
                  outputDirPath = dirPath;
                  console.log(`✅ 直接构建成功，找到输出目录: ${dir}`);
                  break;
                }
              } catch (e) {
                // 忽略读取错误
              }
            }
          }
        }
      } catch (directBuildErr) {
        console.error(`❌ 直接构建也失败: ${directBuildErr.message}`);
      }

      // 如果仍然没有找到输出目录，抛出错误
      if (!foundOutputDir) {
        const errorMsg = `构建产物不存在：未找到任何输出目录（${possibleOutputDirs.join(
          ", "
        )}）`;
        if (!buildSucceeded) {
          throw new Error(
            `${errorMsg}（Turbo 退出码: ${turboExitCode}，直接构建也失败）`
          );
        } else {
          throw new Error(
            `${errorMsg}（Turbo 显示成功但无产物，可能是缓存问题或构建命令执行失败）`
          );
        }
      }
    }

    if (!buildSucceeded && foundOutputDir) {
      console.warn(
        `⚠️ 警告：Turbo 构建命令失败（退出码: ${turboExitCode}），但找到了构建产物 ${foundOutputDir}，继续打包...`
      );
    }

    // 创建 zip 文件
    const zipName = `${pkg.name.replace(/[@/]/g, "-")}-v${version}.zip`;
    const zipPath = path.join(pkgDir, zipName);

    // 删除旧的 zip 文件（如果存在）
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    execSync(`zip -r ${zipName} ${foundOutputDir}/`, {
      cwd: pkgDir,
      stdio: "inherit",
    });

    // 验证 zip 文件是否成功创建且有内容
    if (!fs.existsSync(zipPath)) {
      throw new Error("zip 文件创建失败");
    }

    const zipStats = fs.statSync(zipPath);
    if (zipStats.size === 0) {
      throw new Error("zip 文件为空");
    }

    if (zipStats.size < 100) {
      console.warn(
        `⚠️ 警告：zip 文件很小（${zipStats.size} bytes），可能内容不完整`
      );
    }

    // 移动到 artifacts 目录
    const artifactDir = path.join(repoRoot, "upload_artifacts");
    if (!fs.existsSync(artifactDir))
      fs.mkdirSync(artifactDir, { recursive: true });
    const finalZipPath = path.join(artifactDir, zipName);
    fs.renameSync(zipPath, finalZipPath);

    console.log(
      `✅ ${pkg.name} 打包成功: ${zipName} (${(zipStats.size / 1024).toFixed(
        2
      )} KB)`
    );

    buildResults.push({
      name: pkg.name,
      version: version,
      dir: pkgDir,
      relDir: pkg.relDir,
      zipName: zipName,
      status: "success",
      outputDir: foundOutputDir,
      zipSize: zipStats.size,
    });

    summary += `- ✅ ${pkg.name} (v${version}) - ${zipName}\n`;
    successCount++;
  } catch (err) {
    // 记录失败，但继续处理其他包
    const errorMsg = err.message || String(err);
    console.error(`❌ ${pkg.name} 构建失败: ${errorMsg}`);
    console.error(
      `   原因: ${
        errorMsg.includes("构建产物不存在")
          ? "未找到构建产物，可能是构建命令失败或缺少依赖"
          : errorMsg
      }`
    );
    summary += `- ❌ ${pkg.name} (失败: ${errorMsg})\n`;
    buildResults.push({
      name: pkg.name,
      status: "failed",
      error: errorMsg,
      stack: err.stack,
    });
    failCount++;
    // 继续处理下一个包，不中断整个流程
  }
}

// 输出汇总
fs.writeFileSync(path.join(repoRoot, "build_summary.txt"), summary);
fs.writeFileSync(
  path.join(repoRoot, "build_results.json"),
  JSON.stringify(buildResults, null, 2)
);

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`📊 构建汇总:`);
console.log(`   ✅ 成功: ${successCount}`);
console.log(`   ❌ 失败: ${failCount}`);
console.log(`   📦 总计: ${items.length}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (failCount > 0) {
  console.error(`❌ 有 ${failCount} 个包构建失败，请检查日志`);
  console.log("\n失败详情:");
  buildResults
    .filter((r) => r.status === "failed")
    .forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  process.exit(1);
} else {
  console.log("✅ 所有包构建和打包成功！");
  process.exit(0);
}
