#!/usr/bin/env zx
import { readPreState } from "@changesets/pre";
import readChangesets from "@changesets/read";
// @ts-check

/**
 * 
 * @param {string} cwd 
 * @returns {Promise<{
 *  preState: any | undefined;
 *  changesets: any[];
 * }>}
 */
export async function readChangesetState(
  cwd = process.cwd()
) {
  let preState = await readPreState(cwd);
  let changesets = await readChangesets(cwd);

  if (preState !== undefined && preState.mode === "pre") {
    let changesetsToFilter = new Set(preState.changesets);

    return {
      preState,
      changesets: changesets.filter((x) => !changesetsToFilter.has(x.id)),
    };
  }

  return {
    preState: undefined,
    changesets,
  };
}
