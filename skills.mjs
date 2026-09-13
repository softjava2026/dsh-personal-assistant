/**
 * 挂载本 bundle 自带的 skill，走隔离的 skill provider。
 * 与 openviking 的 skills.mjs 同构：includeDefaultRoots=false，只服务
 * 本 bundle 的 skills/，不遮蔽 DSH 默认 filesystem provider。
 */
import { fileURLToPath } from "node:url";
import * as skillFilesystem from "@deepseek-ai/dsh-skill-filesystem";

import { SKILL_PROVIDER_NAME } from "./config.mjs";

export const SKILLS_DIR = fileURLToPath(new URL("./skills", import.meta.url));

export function buildSkillsConfig() {
  return {
    providerName: SKILL_PROVIDER_NAME,
    includeDefaultRoots: false,
    customSkillDirs: [SKILLS_DIR],
  };
}

export function mountPersonalAssistantSkills(ctx) {
  return ctx.plugin(skillFilesystem, buildSkillsConfig());
}
