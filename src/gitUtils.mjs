#!/usr/bin/env zx
import { $ } from 'zx';
// @ts-check

/**
 * @returns {Promise<boolean>}
 */
export const setupUser = async () => {
  await $`git config user.name ${username}`;
  await $`git config user.email ${email}`;
};

/**
 * 
 * @param {string} branch 
 */
export const pullBranch = async (branch) => {
  await $`git pull origin ${branch}`;
};

/**
 * 
 * @param {string} branch 
 * @param {{ force?: boolean }} param1 
 */
export const push = async (
  branch,
  { force } = {}
) => {
  await $`git push origin ${branch} ${force ? '--force' : ''}`;
};

/**
 * 
 * @param {string} branch 
 */
export const pushTags = async (branch) => {
  await $`git push origin HEAD:${branch} --follow-tags`;
};

/**
 * 
 * @param {string} branch 
 */
export const switchToMaybeExistingBranch = async (branch) => {
  try {
    await $`git checkout ${branch}`;
  } catch (err) {
    echo(`Switching to a new branch ${branch}`)
    await $`git checkout -b ${branch}`;
  }
};

/**
 * 
 * @param {string} pathSpec 
 * @param {"hard" | "soft" | "mixed"} mode 
 */
export const reset = async (
  pathSpec,
  mode = "hard"
) => {
  await $`git reset --${mode} ${pathSpec}`;
};

/**
 * 
 * @param {string} message 
 */
export const commitAll = async (message) => {
  await $`git add -A`;
  await $`git commit -m ${message}`
};

/**
 * 
 * @returns {Promise<boolean>}
 */
export const checkIfClean = async () => {
  const output = await $`git status --porcelain`;
  return output.stdout === "";
};

/**
 * 
 * @param {string} branch 
 */
export const fetchBranch = async (branch) => {
  await $`git fetch --no-tags --depth=5 origin ${branch}`;
};
