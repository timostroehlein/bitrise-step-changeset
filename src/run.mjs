#!/usr/bin/env zx
import { getPackages } from "@manypkg/get-packages";
import writeChangesets from "@changesets/write";
import semver from "semver";
import resolveFrom from "resolve-from";
import {
  getChangedPackages,
  getVersionsByDirectory,
  getChangedPackagesInfo,
  BumpLevels,
} from "./utils.mjs";
import {
  pushTags,
  switchToMaybeExistingBranch,
  reset,
  checkIfClean,
  commitAll,
  push,
  fetchBranch
} from "./gitUtils.mjs";
import { readChangesetState } from "./changesetUtils.mjs";
// @ts-check

const MAX_CHARACTERS_PER_MESSAGE = 32768;

/**
 * 
 * @param {Object} param0
 * @param {string} param0.cwd
 * @param {string} param0.script
 * @param {string} param0.branchDest
 * @param {string} param0.description
 */
export async function runStatus({
  cwd = process.cwd(),
  script,
  branchDest,
  descriptionExists,
  descriptionMissing,
}) {
  // Run status script or changeset status
  cd(cwd);
  if (script) {
    await $.noquote`${script}`;
  } else {
    await fs.ensureDir(`${cwd}/out`);
    await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} status ${branchDest !== "" ? `--since=origin/${branchDest}` : ""} --output=out/changeset.json`;
  }

  // Read changeset.json and create description
  const { releases } = await fs.readJson(`${cwd}/out/changeset.json`);
  let fullDescription = "";
  if (releases.length > 0) {
    fullDescription = [
      descriptionExists,
      "\n---",
      `\nThis PR includes changesets that affect ${releases.length} package${releases.length !== 1 ? 's' : ''}.`,
      "\n|Name|Type|Old Version|New Version|",
      "|----|----|-----------|-----------|",
      ...releases.map((release) => `|${release.name}|${release.type}|${release.oldVersion}|${release.newVersion}|`),
    ].join("\n");
  } else {
    fullDescription = descriptionMissing;
  }
  return fullDescription;
}

/**
 * 
 * @param {string} cwd 
 * @returns 
 */
const requireChangesetsCliPkgJson = (cwd) => {
  try {
    return require(resolveFrom(cwd, "@changesets/cli/package.json"));
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "MODULE_NOT_FOUND"
    ) {
      throw new Error(
        `Have you forgotten to install \`@changesets/cli\` in "${cwd}"?`
      );
    }
    throw err;
  }
};

/**
 * 
 * @param {Object} param0
 * @param {string} param0.description
 * @param {string} param0.preState
 * @param {{
 *  highestLevel: number;
 *  private: boolean;
 *  content: any;
 *  header: string;
 * }[]} param0.changedPackagesInfo
 * @param {number} param0.prBodyMaxCharacters
 * @param {string} param0.branch
 * @returns 
 */
export async function getVersionPrBody({
  description,
  preState,
  changedPackagesInfo,
  prBodyMaxCharacters,
  branch,
}) {
  const messageHeader = description === "" ? `This PR was opened by the [Changeset](https://github.com/timostroehlein/bitrise-step-changeset) Bitrise step.
When you're ready to do a release, you can merge this and the packages will be published to npm automatically.
If you're not ready to do a release yet, that's fine, whenever you add more changesets to ${branch === "" ? "the target branch" : branch}, this PR will be updated.
` : description;
  const messagePrestate = !!preState
    ? `⚠️⚠️⚠️⚠️⚠️⚠️\n
\`${branch === "" ? "the target branch" : branch}\` is currently in **pre mode** so this branch has prereleases rather than normal releases. If you want to exit prereleases, run \`changeset pre exit\` on \`${branch}\`.\n
⚠️⚠️⚠️⚠️⚠️⚠️
` : "";
  const messageReleasesHeading = `# Releases\n---`;

  let fullMessage = [
    messageHeader,
    messagePrestate,
    messageReleasesHeading,
    ...changedPackagesInfo.map((info) => `${info.header}\n---\n${info.content}`),
  ].join("\n");

  // Check that the message does not exceed the size limit.
  // If not, omit the changelog entries of each package.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> The changelog information of each package has been omitted from this message, as the content exceeds the size limit.\n`,
      ...changedPackagesInfo.map((info) => `${info.header}\n\n`),
    ].join("\n");
  }

  // Check (again) that the message is within the size limit.
  // If not, omit all release content this time.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> All release information have been omitted from this message, as the content exceeds the size limit.`,
    ].join("\n");
  }

  return fullMessage;
}

/**
 * 
 * @param {Object} param0 
 * @param {string} param0.cwd
 * @param {string} param0.script
 * @param {string} param0.alignDepsScript
 * @param {string} param0.branch
 * @param {string} param0.branchDest
 * @param {string} param0.commit
 * @param {string} param0.prTitle
 * @param {string} param0.prDescription
 * @param {string} param0.commitMessage
 * @param {number} param0.prBodyMaxCharacters
 * @returns 
 */
export async function runVersion({
  cwd = process.cwd(),
  script,
  installScript,
  alignDepsScript,
  alignDepsPackageName,
  alignDepsMinBumpLevel,
  branch,
  branchDest,
  commit,
  prTitle = "Version Packages",
  prDescription,
  commitMessage = "Version Packages",
  prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
}) {
  const { preState } = await readChangesetState(cwd);
  const { packages } = await getPackages(cwd);

  // Switch to branch and reset it to the latest commit
  await switchToMaybeExistingBranch(branch);
  await reset(commit);

  // Check previous versions
  const previousVersions = await getVersionsByDirectory(cwd);
  await fetchBranch(branchDest);
  await fs.ensureDir(`${cwd}/out`);
  await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} status --output=out/changeset.json`;
  const { releases } = await fs.readJson(`${cwd}/out/changeset.json`);
  const highestLevel = Math.max(...releases.map(release => BumpLevels[release.type]));

  // Run version script or changeset version
  cd(cwd);
  const version = async () => {
    if (script) {
      await $.noquote`${script}`;
    } else {
      let changesetsCliPkgJson = requireChangesetsCliPkgJson(cwd);
      let cmd = semver.lt(changesetsCliPkgJson.version, "2.0.0")
        ? "bump"
        : "version";
      await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} ${cmd}`;
    }
  }
  await version();

  // Get changes of all packages
  let changedPackages = await getChangedPackages(cwd, previousVersions);
  let changedPackagesInfo = await getChangedPackagesInfo(changedPackages);

  // Run align-deps
  if (alignDepsScript) {
    await $.noquote`${alignDepsScript}`;

    // Create a changeset for align-deps if the min bump level version is exceeded
    aligndeps: if (highestLevel >= BumpLevels[alignDepsMinBumpLevel]) {
      if (alignDepsPackageName === "") {
        echo("Cannot create align deps without package name");
        break aligndeps;
      }
      if (!packages.some(pkg => pkg.packageJson.name === alignDepsPackageName)) {
        echo(`Cannot find package ${alignDepsPackageName} in repo`);
        break aligndeps;
      }
      const changeset = {
        summary: '',
        releases: [
          {
            name: alignDepsPackageName,
            type: isMajorVersionIncrease ? 'minor' : 'patch',
          },
        ],
      };
      await writeChangesets(changeset, cwd);

      // Run version script
      await version();

      // Get changes of all packages
      changedPackages = await getChangedPackages(cwd, previousVersions);
      changedPackagesInfo = await getChangedPackagesInfo(changedPackages);
    } else {
      echo(`Bumping of align-deps package not necessary ${highestLevel} < ${BumpLevels[alignDepsMinBumpLevel]}`);
    }
  }

  // Run install script
  if (installScript) {
    await $.noquote`${installScript}`;
  }

  // Project with `commit: true` setting could have already committed files
  if (!(await checkIfClean())) {
    const finalCommitMessage = `${commitMessage}${
      !!preState ? ` (${preState.tag})` : ""
    }`;
    await commitAll(finalCommitMessage);
  }

  // Push all changes
  await push(branch, { force: true });

  // Create PR title and body
  const finalPrTitle = `${prTitle}${!!preState ? ` (${preState.tag})` : ""}`;
  const prBody = await getVersionPrBody({
    description: prDescription,
    preState,
    branch: branchDest,
    changedPackagesInfo,
    prBodyMaxCharacters,
  });

  return {
    prTitle: finalPrTitle,
    prBody,
  };
}

/**
 * 
 * @param {Object} param0
 * @param {string} param0.cwd
 * @param {string} param0.script
 * @returns 
 */
export async function runPublish({
  cwd = process.cwd(),
  script,
}) {
  // Run publish script or changeset status
  cd(cwd);
  if (script) {
    await $.noquote`${script}`;
  } else {
    await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} publish`;
  }
  
  // Push git tags
  await pushTags();

  let { packages, tool } = await getPackages(cwd);
  let releasedPackages = [];

  if (tool !== "root") {
    let newTagRegex = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;
    let packagesByName = new Map(packages.map((x) => [x.packageJson.name, x]));

    for (let line of changesetPublishOutput.stdout.split("\n")) {
      let match = line.match(newTagRegex);
      if (match === null) {
        continue;
      }
      let pkgName = match[1];
      let pkg = packagesByName.get(pkgName);
      if (pkg === undefined) {
        throw new Error(
          `Package "${pkgName}" not found.` +
            "This is probably a bug in the action, please open an issue"
        );
      }
      releasedPackages.push(pkg);
    }
  } else {
    if (packages.length === 0) {
      throw new Error(
        `No package found.` +
          "This is probably a bug in the action, please open an issue"
      );
    }
    let pkg = packages[0];
    let newTagRegex = /New tag:/;

    for (let line of changesetPublishOutput.stdout.split("\n")) {
      let match = line.match(newTagRegex);

      if (match) {
        releasedPackages.push(pkg);
        break;
      }
    }
  }

  if (releasedPackages.length) {
    return {
      published: true,
      publishedPackages: releasedPackages.map((pkg) => ({
        name: pkg.packageJson.name,
        version: pkg.packageJson.version,
      })),
    };
  }

  return { published: false };
}
