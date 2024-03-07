#!/usr/bin/env zx
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { toString as mdastToString } from "mdast-util-to-string";
import { getPackages } from "@manypkg/get-packages";
// @ts-check

export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * 
 * @param {string} cwd 
 * @returns {Promise<Map<any, any>>}
 */
export async function getVersionsByDirectory(cwd) {
  let { packages } = await getPackages(cwd);
  return new Map(packages.map((x) => [x.dir, x.packageJson.version]));
}

/**
 * 
 * @param {string} cwd 
 * @param {Map<string, string>} previousVersions 
 * @returns 
 */
export async function getChangedPackages(
  cwd,
  previousVersions
) {
  let { packages } = await getPackages(cwd);
  let changedPackages = new Set();

  for (let pkg of packages) {
    const previousVersion = previousVersions.get(pkg.dir);
    if (previousVersion !== pkg.packageJson.version) {
      changedPackages.add(pkg);
    }
  }

  return [...changedPackages];
}

/**
 * 
 * @param {string} changelog 
 * @param {string} version 
 * @returns 
 */
export function getChangelogEntry(changelog, version) {
  let ast = unified().use(remarkParse).parse(changelog);

  /** @type {number} */
  let highestLevel = BumpLevels.dep;

  /** @type {Array<any>} */
  let nodes = ast.children;
  /** @type {{ index: number; depth: number; }| undefined} */
  let headingStartInfo;
  /** @type {number | undefined} */
  let endIndex;

  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (node.type === "heading") {
      /** @type {string} */
      let stringified = mdastToString(node);
      /** @type {"major" | "minor" | "patch"} */
      let match = stringified.toLowerCase().match(/(major|minor|patch)/);
      if (match !== null) {
        let level = BumpLevels[match[0]];
        highestLevel = Math.max(level, highestLevel);
      }
      if (headingStartInfo === undefined && stringified === version) {
        headingStartInfo = {
          index: i,
          depth: node.depth,
        };
        continue;
      }
      if (
        endIndex === undefined &&
        headingStartInfo !== undefined &&
        headingStartInfo.depth === node.depth
      ) {
        endIndex = i;
        break;
      }
    }
  }
  if (headingStartInfo) {
    ast.children = (ast.children).slice(
      headingStartInfo.index + 1,
      endIndex
    );
  }
  return {
    content: unified().use(remarkStringify).stringify(ast),
    highestLevel: highestLevel,
  };
}

/**
 * 
 * @param {{ private: boolean; highestLevel: number }} a 
 * @param {{ private: boolean; highestLevel: number }} b 
 * @returns 
 */
export function sortTheThings(
  a,
  b
) {
  if (a.private === b.private) {
    return b.highestLevel - a.highestLevel;
  }
  if (a.private) {
    return 1;
  }
  return -1;
}
