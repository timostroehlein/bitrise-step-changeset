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
import * as gitUtils from "./gitUtils.mjs";
import { readChangesetState } from "./readChangesetState.mjs";
// @ts-check

// Bitbucket pull request description limit
// TODO: move to step input
const MAX_CHARACTERS_PER_MESSAGE = 32768;

/**
 * 
 * @param {{ pkg: any; tagName: string }} param1 
 */
const createRelease = async (
  { pkg, tagName }
) => {
  try {
    let changelogFileName = path.join(pkg.dir, "CHANGELOG.md");

    let changelog = await fs.readFile(changelogFileName, "utf8");

    let changelogEntry = getChangelogEntry(changelog, pkg.packageJson.version);
    if (!changelogEntry) {
      // we can find a changelog but not the entry for this version
      // if this is true, something has probably gone wrong
      throw new Error(
        `Could not find changelog entry for ${pkg.packageJson.name}@${pkg.packageJson.version}`
      );
    }

    // TODO: change
    /*
    await octokit.rest.repos.createRelease({
      name: tagName,
      tag_name: tagName,
      body: changelogEntry.content,
      prerelease: pkg.packageJson.version.includes("-"),
      ...github.context.repo,
    }); */
  } catch (err) {
    // if we can't find a changelog, the user has probably disabled changelogs
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code !== "ENOENT"
    ) {
      throw err;
    }
  }
};

/**
 * 
 * @param {*} param0 
 * @returns 
 */
export async function runPublish({
  script,
  githubToken,
  createGithubReleases,
  cwd = process.cwd(),
}) {
  let [publishCommand, ...publishArgs] = script.split(/\s+/);
  return;

  let changesetPublishOutput = await getExecOutput(
    publishCommand,
    publishArgs,
    { cwd }
  );

  await gitUtils.pushTags();

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
/*
    if (createGithubReleases) {
      await Promise.all(
        releasedPackages.map((pkg) =>
          createRelease(octokit, {
            pkg,
            tagName: `${pkg.packageJson.name}@${pkg.packageJson.version}`,
          })
        )
      );
    } */
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
        /*
        if (createGithubReleases) {
          await createRelease(octokit, {
            pkg,
            tagName: `v${pkg.packageJson.version}`,
          });
        } */
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
  let messageHeader = `This PR was opened by the [Changesets release](https://github.com/changesets/action) GitHub action. When you're ready to do a release, you can merge this and ${
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

export async function runVersion({
  script,
  githubToken,
  cwd = process.cwd(),
  prTitle = "Version Packages",
  commitMessage = "Version Packages",
  hasPublishScript = false,
  prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
}) {
  // const octokit = setupOctokit(githubToken);

  // let repo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  // let branch = github.context.ref.replace("refs/heads/", "");
  let branch = 'changeset-test'; // TODO: change
  let versionBranch = `release/${branch}`;

  let { preState } = await readChangesetState(cwd);

  await gitUtils.switchToMaybeExistingBranch(versionBranch);
  // await gitUtils.reset(github.context.sha); // TODO: change

  let versionsByDirectory = await getVersionsByDirectory(cwd);

  if (script) {
    let [versionCommand, ...versionArgs] = script.split(/\s+/);
    cd(cwd);
    await $`${versionCommand} ${versionArgs}`; // TODO: cwd?
  } else {
    let changesetsCliPkgJson = requireChangesetsCliPkgJson(cwd);
    let cmd = semver.lt(changesetsCliPkgJson.version, "2.0.0")
      ? "bump"
      : "version";
    cd(cwd);
    await $`node ${resolveFrom(cwd, "@changesets/cli/bin.js")} ${cmd}`; // TODO: cwd?
  }

  // let searchQuery = `repo:${repo}+state:open+head:${versionBranch}+base:${branch}+is:pull-request`;
  // let searchResultPromise = octokit.rest.search.issuesAndPullRequests({
  //   q: searchQuery,
  // });
  let changedPackages = await getChangedPackages(cwd, versionsByDirectory);
  let changedPackagesInfoPromises = Promise.all(
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

  const finalPrTitle = `${prTitle}${!!preState ? ` (${preState.tag})` : ""}`;

  // project with `commit: true` setting could have already committed files
  if (!(await gitUtils.checkIfClean())) {
    const finalCommitMessage = `${commitMessage}${
      !!preState ? ` (${preState.tag})` : ""
    }`;
    await gitUtils.commitAll(finalCommitMessage);
  }

  await gitUtils.push(versionBranch, { force: true });

  let searchResult = await searchResultPromise;
  core.info(JSON.stringify(searchResult.data, null, 2));

  const changedPackagesInfo = (await changedPackagesInfoPromises)
    .filter((x) => x)
    .sort(sortTheThings);
/*
  let prBody = await getVersionPrBody({
    hasPublishScript,
    preState,
    branch,
    changedPackagesInfo,
    prBodyMaxCharacters,
  });

  if (searchResult.data.items.length === 0) {
    core.info("creating pull request");
    const { data: newPullRequest } = await octokit.rest.pulls.create({
      base: branch,
      head: versionBranch,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return {
      pullRequestNumber: newPullRequest.number,
    };
  } else {
    const [pullRequest] = searchResult.data.items;

    core.info(`updating found pull request #${pullRequest.number}`);
    await octokit.rest.pulls.update({
      pull_number: pullRequest.number,
      title: finalPrTitle,
      body: prBody,
      ...github.context.repo,
    });

    return {
      pullRequestNumber: pullRequest.number,
    };
  } */
}
