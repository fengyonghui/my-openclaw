#!/usr/bin/env node
/**
 * 恢复全局技能 + 默认启用 3 个 builtin 技能
 *
 * 用法：node scripts/restore-skills.mjs [--dry-run]
 *
 * 数据源：
 * - 当前 db.json
 * - 历史 db.json (从 git blob 473ca66 提取)
 *
 * 逻辑：
 * 1. 把历史 availableSkills 合并到当前（按 id 去重）
 * 2. 给所有项目的 enabledSkillIds 加上 3 个 builtin id
 * 3. 保存 db.json
 *
 * 3 个 builtin id 与 backend/src/services/BuiltinSkills.ts 中的常量一致：
 * - builtin-file-io
 * - builtin-shell-cmd
 * - builtin-inline-python-edit
 */

import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DB_PATH = resolve(process.cwd(), 'backend/data/db.json');
// 历史技能快照从 git 提取到本文件，运行 scripts/extract-historical-skills.mjs 重新生成
const HISTORICAL_SKILLS_PATH = resolve(process.cwd(), 'tmp/historical-skills.json');

const BUILTIN_IDS = [
  'builtin-file-io',
  'builtin-shell-cmd',
  'builtin-inline-python-edit',
];

const dryRun = process.argv.includes('--dry-run');

function loadHistoricalDb() {
  return JSON.parse(readFileSync(HISTORICAL_SKILLS_PATH, 'utf-8'));
}

async function main() {
  const currentDb = JSON.parse(await readFile(DB_PATH, 'utf-8'));
  // historical-skills.json 是 array，不是 db object
  const historicalSkills = loadHistoricalDb();
  const existingSkills = currentDb.availableSkills || [];

  const existingIds = new Set(existingSkills.map((s) => s.id));
  const toAdd = historicalSkills.filter((s) => !existingIds.has(s.id));

  console.log(`[restore-skills] historical availableSkills: ${historicalSkills.length}`);
  console.log(`[restore-skills] current availableSkills:   ${existingSkills.length}`);
  console.log(`[restore-skills] to merge in:                ${toAdd.length}`);
  for (const s of toAdd) {
    console.log(`  + ${s.name} (id=${s.id})`);
  }

  if (!dryRun) {
    currentDb.availableSkills = [...existingSkills, ...toAdd];
  }

  // Step 2: 给所有项目默认启用 3 个 builtin
  const projects = currentDb.projects || [];
  let projectUpdates = 0;
  for (const proj of projects) {
    const before = proj.enabledSkillIds || [];
    const merged = Array.from(new Set([...before, ...BUILTIN_IDS]));
    if (merged.length !== before.length) {
      const added = merged.filter((id) => !before.includes(id));
      console.log(`[restore-skills] ${proj.id}: enabledSkillIds +${added.join(', ')}`);
      if (!dryRun) proj.enabledSkillIds = merged;
      projectUpdates++;
    }
  }
  console.log(`[restore-skills] updated projects: ${projectUpdates}`);

  if (!dryRun) {
    await writeFile(DB_PATH, JSON.stringify(currentDb, null, 2), 'utf-8');
    console.log(`[restore-skills] saved ${DB_PATH}`);
  } else {
    console.log(`[restore-skills] --dry-run: not saved`);
  }
}

main().catch((err) => {
  console.error('[restore-skills] failed:', err);
  process.exit(1);
});
