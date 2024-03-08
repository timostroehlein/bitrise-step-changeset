#!/usr/bin/env zx
import { getPackages } from "@manypkg/get-packages";
import semver from "semver";
import resolveFrom from "resolve-from";
import {
  getChangelogEntry,
  getChangedPackages,
  sortTheThings,
  getVersionsByDirectory,
} from "./utils.mjs";
import {
  pushTags,
  switchToMaybeExistingBranch,
  reset,
  checkIfClean,
  commitAll,
  push
} from "./gitUtils.mjs";
import { readChangesetState } from "./readChangesetState.mjs";
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
    await $`${script}`;
  } else {
    await fs.ensureDir(`${cwd}/out`);
    const output = await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} status ${branchDest !== "" ? `--since=${branchDest}` : ""} --output=out/changeset.json`;
    echo(output);
  }

  // Read changeset.json and create description
  const { releases } = await fs.readJson(`${cwd}/out/changeset.json`);
  let fullDescription = "";
  if (releases.length > 0) {
    fullDescription = [
      descriptionExists,
      `\nThis PR includes changesets to release ${releases.length} package${releases.length > 1 ? 's' : ''})`,
      "```",
      "\n|Name|Type|Old Version|New Version|",
      "|----|----|-----------|-----------|",
      ...releases.map((release) => `|${release.name}|${release.type}|${release.oldVersion}|${release.newVersion}|`),
      "```",
    ].join("\n");
  } else {
    fullDescription = descriptionMissing;
  }
  return fullDescription;
}

/**
 * 
 * @param {*} param0 
 * @returns 
 */
export async function runPublish({
  cwd = process.cwd(),
  script,
}) {
  // Run publish script or changeset status
  cd(cwd);
  if (script) {
    await $`${script}`;
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

export async function getVersionPrBody({
  hasPublishScript,
  preState,
  changedPackagesInfo,
  prBodyMaxCharacters,
  branch,
}) {
  let messageHeader = `This PR was opened by the [Changeset](https://github.com/timostroehlein/bitrise-step-changeset) Bitrise step. When you're ready to do a release, you can merge this and ${
    hasPublishScript
      ? `the packages will be published to npm automatically`
      : `publish to npm yourself or [setup this action to publish automatically](https://github.com/changesets/action#with-publishing)`
  }. If you're not ready to do a release yet, that's fine, whenever you add more changesets to ${branch}, this PR will be updated.
`;
  let messagePrestate = !!preState
    ? `⚠️⚠️⚠️⚠️⚠️⚠️

\`${branch}\` is currently in **pre mode** so this branch has prereleases rather than normal releases. If you want to exit prereleases, run \`changeset pre exit\` on \`${branch}\`.

⚠️⚠️⚠️⚠️⚠️⚠️
`
    : "";
  let messageReleasesHeading = `# Releases`;

  let fullMessage = [
    messageHeader,
    messagePrestate,
    messageReleasesHeading,
    ...changedPackagesInfo.map((info) => `${info.header}\n\n${info.content}`),
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
 * @param {string} param0.branch
 * @param {string} param0.commit
 * @param {string} param0.prTitle
 * @param {string} param0.commitMessage
 * @param {boolean} param0.hasPublishScript
 * @param {string} param0.prBodyMaxCharacters
 * @returns 
 */
export async function runVersion({
  cwd = process.cwd(),
  script,
  branch,
  commit,
  prTitle = "Version Packages",
  commitMessage = "Version Packages",
  hasPublishScript = false,
  prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
}) {
  let { preState } = await readChangesetState(cwd);

  // Switch to branch and reset it to the latest commit
  await switchToMaybeExistingBranch(branch);
  await reset(commit);

  let versionsByDirectory = await getVersionsByDirectory(cwd);

  // Run version script or changeset version
  cd(cwd);
  if (script) {
    await $`${script}`;
  } else {
    let changesetsCliPkgJson = requireChangesetsCliPkgJson(cwd);
    let cmd = semver.lt(changesetsCliPkgJson.version, "2.0.0")
      ? "bump"
      : "version";
    await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} ${cmd}`;
  }

  // Get changelog of all packages
  let changedPackages = await getChangedPackages(cwd, versionsByDirectory);
  const changedPackagesInfoPromises = Promise.all(
    changedPackages.map(async (pkg) => {
      let changelogContents = await fs.readFile(
        path.join(pkg.dir, "CHANGELOG.md"),
        "utf8"
      );

      let entry = getChangelogEntry(changelogContents, pkg.packageJson.version);
      return {
        highestLevel: entry.highestLevel,
        private: !!pkg.packageJson.private,
        content: entry.content,
        header: `## ${pkg.packageJson.name}@${pkg.packageJson.version}`,
      };
    })
  );
  const changedPackagesInfo = (await changedPackagesInfoPromises)
    .filter((x) => x)
    .sort(sortTheThings);

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
    hasPublishScript,
    preState,
    branch,
    changedPackagesInfo,
    prBodyMaxCharacters,
  });
  echo(finalPrTitle);
  echo(prBody);

  return {
    prTitle: finalPrTitle,
    prBody,
  };
}
