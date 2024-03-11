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
import "@changesets/write";
import "@manypkg/get-packages";
import { findRoot } from "@manypkg/find-root";
import { runPublish, runStatus, runVersion } from "./run.mjs";
import { readChangesetState } from "./changesetUtils.mjs";
import { createNpmrc } from "./utils.mjs";
// @ts-check

// https://github.com/google/zx/issues/126#issuecomment-850621670
$.noquote = async (...args) => { const q = $.quote; $.quote = v => v; const p = $(...args); await p; $.quote = q; return p };

// General inputs
const commitHash = process.env.commit_hash;
const branchDest = process.env.branch_dest;
// Status inputs
const shouldRunStatusScript = process.env.run_status === "true";
const statusScript = process.env.status_script;
const statusExistsDescription = process.env.status_exists_description;
const statusMissingDescription = process.env.status_missing_description;
// Version inputs
const shouldRunVersionScript = process.env.run_version === "true";
const versionScript = process.env.version_script;
const installScript = process.env.install_script;
const alignDepsScript = process.env.align_deps_script;
const alignDepsPackageName = process.env.align_deps_package_name;
const alignDepsMinBumpLevel = process.env.align_deps_min_bump_level;
const versionBranch = process.env.version_branch;
const versionCommitMessage = process.env.version_commit_message;
const versionPrTitle = process.env.version_pr_title;
const versionPrDescription = process.env.version_pr_description;
const versionPrBodyMaxLength = process.env.version_pr_body_max_length;
// Publish inputs
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
await $`envman add --key CHANGESET_EXISTS --value=${hasChangesets}`;
await $`envman add --key CHANGESET_PUBLISHED --value="false"`;

// Changeset status
if (shouldRunStatusScript) {
  echo("Running changeset status");
  const description = await runStatus({
    cwd: rootDir,
    script: statusScript,
    branchDest,
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
    installScript,
    alignDepsScript,
    alignDepsPackageName,
    alignDepsMinBumpLevel,
    branch: versionBranch,
    branchDest,
    commit: commitHash,
    prTitle: versionPrTitle,
    prDescription: versionPrDescription,
    commitMessage: versionCommitMessage,
    hasPublishScript: shouldRunPublishScript,
    prBodyMaxCharacters: Number(versionPrBodyMaxLength),
  });

  // Add output env variables
  await $`envman add --key CHANGESET_PR_BRANCH --value=${versionBranch}`;
  await $`envman add --key CHANGESET_PR_TITLE --value=${prTitle}`;
  await $`envman add --key CHANGESET_PR_DESCRIPTION --value=${prBody}`;
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
    script: publishScript
  });

  // Add output env variables
  if (result.published) {
    await $`envman add --key CHANGESET_PUBLISHED --value="true"`;
    await $`envman add --key CHANGESET_PUBLISHED_PACKAGES --value=${JSON.stringify(result.publishedPackages)}`;
  }
} else {
  echo("Changeset publish disabled");
}
