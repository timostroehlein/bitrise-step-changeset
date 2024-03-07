import { readPreState } from "@changesets/pre";
import readChangesets from "@changesets/read";

/**
 * 
 * @param {string} cwd 
 * @returns {{ preState: any | undefined; changesets: any[]; }}
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