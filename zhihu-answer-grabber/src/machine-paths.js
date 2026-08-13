// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 机器 artifact 路径（BUG_ID: B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE 修复）。
 *
 * 合同：Product Behavior Contract §3.3 APPROVED_TARGET_BEHAVIOR = OPTION A
 *  - 同盘 / 正常可表达：artifacts 路径 relative-to-cwd，且【不发射】base 字段
 *    （absence ⇒ legacy cwd-relative 语义；机器 JSON 与旧版逐字节一致）
 *  - cwd-relative 无法表达时（如 Windows 跨盘，native path.relative 返回
 *    drive-qualified / 绝对路径）：artifacts 路径 relative-to-effective-out-dir，
 *    并发射 base = "outdir"
 *  - fail closed：两种表示都无法生成安全相对路径 → 返回 null（绝不输出绝对路径）
 *
 * 检测语义（不是 process.platform 判断）：唯一判据是
 * "path.relative(cwd, absPath) 是否为合法相对路径"。
 *
 * 注：handoff 内部 inputJson/inputMarkdown 是相对 handoff 所在目录的独立合同，
 * 不消费本模块（见 references/handoff-schema.md）。
 */
import path from 'node:path';

/**
 * 构建机器 artifact 路径集合。
 *
 * @param {string} dir 产物目录（绝对路径，如 <out>/<qid>）
 * @param {{cwd: string, outDirRoot: string, pathImpl?: object}} opts
 *   cwd: 本次 CLI 调用的工作目录（process.cwd()）
 *   outDirRoot: effective invocation out-dir root（path.resolve(cwd, 用户传入 --out-dir)）
 *   pathImpl: 可注入的 path 实现（测试用 path.win32 / path.posix；默认 native）
 * @returns {{json: string, markdown: string, progress: string, base?: 'outdir'} | null}
 *   null = fail closed（无法生成安全的相对机器路径）
 */
export function machineArtifacts(dir, { cwd, outDirRoot, pathImpl = path }) {
  // 批次 base 判定：产物目录相对 cwd 是否可表达为合法相对路径
  const dirRel = pathImpl.relative(cwd, dir);
  const base = dirRel && !pathImpl.isAbsolute(dirRel) ? null : 'outdir';
  const root = base === 'outdir' ? outDirRoot : cwd;

  const relOf = (file) => {
    const r = pathImpl.relative(root, pathImpl.join(dir, file));
    if (r && !pathImpl.isAbsolute(r)) return r.split(pathImpl.sep).join('/');
    return null; // fail closed：绝不输出绝对 / drive-qualified 路径
  };

  const json = relOf('answers.json');
  const markdown = relOf('answers.md');
  const progress = relOf('.progress.json');
  if (json === null || markdown === null || progress === null) return null;

  return { json, markdown, progress, ...(base ? { base } : {}) };
}
