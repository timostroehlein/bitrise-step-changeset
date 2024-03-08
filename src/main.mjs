#!/usr/bin/env zx
/**
 * Written using zx:
 * https://google.github.io/zx
 * Source code mostly taken from official changeset github action:
 * https://github.com/changesets/action
 * Packages need to be imported at the beginning, otherwise they won't get installed.
 */
import "zx";
import "semver";
import "unified";
import "resolve-from";
import "remark-parse";
import "remark-stringify";
import "mdast-util-to-string";
import "@changesets/pre";
import "@changesets/read";
import "@manypkg/get-packages";
import { findRoot } from "@manypkg/find-root";
import { runPublish, runStatus, runVersion } from "./run.mjs";
import { readChangesetState } from "./readChangesetState.mjs";
import { createNpmrc } from "./utils.mjs";
// @ts-check

// General
const commitHash = process.env.BITRISE_GIT_COMMIT;
// Status
const shouldRunStatusScript = process.env.run_status === "true";
const statusScript = process.env.status_script;
const statusBranchDest = process.env.status_branch_dest;
const statusExistsDescription = process.env.status_exists_description;
const statusMissingDescription = process.env.status_missing_description;
// Version
const shouldRunVersionScript = process.env.run_version === "true";
const versionScript = process.env.version_script;
const versionBranch = process.env.version_branch;
const versionCommitMessage = process.env.version_commit_message;
const versionPrTitle = process.env.version_pr_title;
const versionPrBodyMaxLength = process.env.version_pr_body_max_length
// Publish
const shouldRunPublishScript = process.env.run_publish === "true";
const publishScript = process.env.publish_script;

// Check whether there are any changesets
const { rootDir } = await findRoot(process.cwd());
const { changesets } = await readChangesetState(rootDir);

const hasChangesets = changesets.length !== 0;
const hasNonEmptyChangesets = changesets.some(
  (changeset) => changeset.releases.length > 0
);

// Add output env variables
await $`envman add --key CHANGESET_EXISTS --value "${hasChangesets}"`;
await $`envman add --key CHANGESET_PUBLISHED --value "false"`;

// Changeset status
if (shouldRunStatusScript) {
  echo("Changesets found, running changeset status");
  const description = await runStatus({
    cwd: rootDir,
    script: statusScript,
    branchDest: statusBranchDest,
    descriptionExists: statusExistsDescription,
    descriptionMissing: statusMissingDescription
  });
  await $`envman add --key CHANGESET_STATUS_DESCRIPTION --value=${description}`;
} else {
  echo("Changeset status disabled");
}

// Changeset version
version: if (shouldRunVersionScript) {
  if (!hasChangesets) {
    echo("No changesets found, skipping changeset version");
    break version;
  }
  if (!hasNonEmptyChangesets) {
    echo("All changesets are empty, skipping changeset version");
    break version;
  }
  echo("Changesets found, attempting to version packages");
  const { prTitle, prBody } = await runVersion({
    cwd: rootDir,
    script: versionScript,
    branch: versionBranch,
    commit: commitHash,
    prTitle: versionPrTitle,
    commitMessage: versionCommitMessage,
    hasPublishScript: shouldRunPublishScript,
    prBodyMaxCharacters: Number(versionPrBodyMaxLength),
  });

  // Add output env variables
  await $`envman add --key CHANGESET_PR_BRANCH --value "${versionBranch}"`;
  await $`envman add --key CHANGESET_PR_TITLE --value "${prTitle}"`;
  await $`envman add --key CHANGESET_PR_DESCRIPTION --value "${prBody}"`;
} else {
  echo("Changeset version disabled");
}

// Changeset publish
publish: if (shouldRunPublishScript) {
  if (hasChangesets) {
    echo("Changesets found, skipping publish, make sure to run changeset version first");
    break publish;
  }
  echo(
    "No changesets found, attempting to publish any unpublished packages to npm"
  );

  // Create .npmrc in user directory if it doesn't exist
  await createNpmrc();

  // Publish changesets
  const result = await runPublish({
    cwd: rootDir,
    script: publishScript,
  });

  // Add output env variables
  if (result.published) {
    await $`envman add --key CHANGESET_PUBLISHED --value "true"`;
    await $`envman add --key CHANGESET_PUBLISHED_PACKAGES --value "${JSON.stringify(result.publishedPackages)}"`;
  }
} else {
  echo("Changeset publish disabled");
}
