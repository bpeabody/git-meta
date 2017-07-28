/*
 * Copyright (c) 2016, Two Sigma Open Source
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of git-meta nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

/**
 * This module contains methods for doing checkouts.
 */
const assert  = require("chai").assert;
const co      = require("co");
const colors  = require("colors");
const NodeGit = require("nodegit");

const GitUtil          = require("./git_util");
const SubmoduleFetcher = require("./submodule_fetcher");
const SubmoduleUtil    = require("./submodule_util");
const UserError        = require("./user_error");

/**
 * If the specified `name` matches the tracking branch for one and only one
 * remote in the specified `repo`, return that remote; otherwise, return null.
 *
 * @param {NodeGit.Repository} repo
 * @param {String}             name
 * @return {NodeGit.Remote|null}
 */
exports.findTrackingBranch = co.wrap(function *(repo, name) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.isString(name);
    let result = null;
    const refs = yield repo.getReferenceNames(NodeGit.Reference.TYPE.LISTALL);
    const matcher = new RegExp(`^refs/remotes/(.*)/${name}$`);
    for (let i = 0; i < refs.length; ++i) {
        const refName = refs[i];
        const match = matcher.exec(refName);
        if (null !== match) {
            if (null !== result) {
                // We have a match but it's not unique.

                return null;                                          // RETURN
            }
            result = match[1];
        }
    }
    return result;
});

/**
 * Checkout the specified `commit` in the specified `metaRepo`, and update all
 * open submodules to be on the indicated commit, fetching it if necessary.
 * Throw a `UserError` if one of the submodules or the meta-repo cannot be
 * checked out.
 *
 * @async
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Commit}     commit
 * @param {Boolean}            force
 */
exports.checkoutCommit = co.wrap(function *(metaRepo, commit, force) {
    assert.instanceOf(metaRepo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);
    assert.isBoolean(force);

    metaRepo.submoduleCacheAll();

    const open = yield SubmoduleUtil.listOpenSubmodules(metaRepo);
    const names = yield SubmoduleUtil.getSubmoduleNamesForCommit(metaRepo,
                                                                 commit);
    const shas = yield SubmoduleUtil.getSubmoduleShasForCommit(metaRepo,
                                                               names,
                                                               commit);
    const subFetcher = new SubmoduleFetcher(metaRepo, commit);

    // First, do dry runs.

    let errors = [];

    /**
     * If it is possible to check out the specified `commit` in the specified
     * `repo`, return `null`; otherwise, return an error message.
     */
    const dryRun = co.wrap(function *(repo, commit) {
        try {
            yield NodeGit.Checkout.tree(repo, commit, {
                checkoutStrategy: NodeGit.Checkout.STRATEGY.NONE,
            });
            return null;                                              // RETURN
        }
        catch(e) {
            return e.message;                                         // RETURN
        }
    });

    const cache = {};  // name to { repo, commit}

    // Load repo/commit cache
    yield open.map(co.wrap(function *(name) {
        const repo = yield SubmoduleUtil.getRepo(metaRepo, name);
        const sha = shas[name];
        yield subFetcher.fetchSha(repo, name, sha);
        const commit = yield repo.getCommit(sha);
        cache[name] = { repo: repo, commit: commit };
    }));

    if (!force) {

        // Check meta

        const metaError = yield dryRun(metaRepo, commit);
        if (null !== metaError) {
            errors.push(`Unable to check out meta-repo: ${metaError}.`);
        }

        // Try the submodules; store the opened repos and loaded commits for
        // use in the actual checkout later.


        yield open.map(co.wrap(function *(name) {
            // Open repo but not alive on this commit.

            if (!(name in shas)) {
                return;                                               // RETURN
            }
            const cached = cache[name];
            const error = yield dryRun(cached.repo, cached.commit);
            if (null !== error) {
                errors.push(`\
Unable to checkout submodule ${colors.yellow(name)}: ${error}.`);
            }
        }));

        // Throw an error if any dry-runs failed.

        if (0 !== errors.length) {
            throw new UserError(errors.join("\n"));
        }
    }

    /**
     * Checkout and set as head the specified `commit` in the specified `repo`.
     */
    const doCheckout = co.wrap(function *(repo, commit) {
        const strategy = force ?
            NodeGit.Checkout.STRATEGY.FORCE :
            NodeGit.Checkout.STRATEGY.SAFE;
        yield NodeGit.Checkout.tree(repo, commit, {
            checkoutStrategy: strategy,
        });
        repo.setHeadDetached(commit);
    });

    // Now do the actual checkouts.

    yield doCheckout(metaRepo, commit);

    yield open.map(co.wrap(function *(name) {
        // Open repo but not alive on this commit.

        if (!(name in shas)) {
            return;                                                   // RETURN
        }
        const c = cache[name];
        yield doCheckout(c.repo, c.commit);
    }));

    metaRepo.submoduleCacheClear();
});

/**
 * Return an object describing the remote and branch name of the specified
 * `trackingBranch` if it is valid in the specified `repo`, or throw a
 * `UserError` if it is not.
 *
 * @param {NodeGit.Repository} repo
 * @param {String}             trackingBranch
 * @return {Object}
 * @return {String} return.remoteName
 * @return {String} return.branchName
 */
exports.validateTrackingBranch = co.wrap(function *(repo, trackingBranch) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.isString(trackingBranch);
    const parts = trackingBranch.split("/");
    if (2 !== parts.length) {
        throw new UserError(
            `Invalid tracking branch ${colors.red(trackingBranch)}`);
    }
    const remoteName = parts[0];
    const branchName = parts[1];
    if (!(yield GitUtil.isValidRemoteName(repo, remoteName))) {
        throw new UserError(
            `Invalid remote name ${colors.red(remoteName)}`);
    }
    if (null === (yield GitUtil.findBranch(repo, trackingBranch))) {
        throw new UserError(`\
There is no branch ${colors.red(branchName)} for remote \
${colors.yellow(remoteName)}`);
    }
    return {
        remoteName: remoteName,
        branchName: branchName,
    };
});

/**
 * Return an object describing what operation to perform in the specified
 * `repo` based on the optionally specified `committish`, the optionally
 * specified `newBranch` name, and the specified `track` flag.  Throw a
 * `UserError` if the arguments provided are not valid within `repo`.
 *
 * The behavior required by Git is otherwise far too baroque to write a
 * meaningful contract; look at the code and/or the test driver.
 *
 * @param {NodeGit.Repository} repo
 * @param {String|null}        committish
 * @param {String|null}        newBranch
 * @param {Boolean}            track
 * @return {Object}
 * @return {NodeGit.Commit}      return.commit           to check out
 * @return {Object|null}         return.newBranch        to create
 * @return {String}              return.newBranch.name
 * @return {Object|null}         return.newBranch.tracking
 * @return {String|null}         return.newBranch.tracking.remoteName
 * @return {String}              return.newBranch.tracking.branchName
 * @return {String|null}         return.switchBranch     to make current
 */
exports.deriveCheckoutOperation = co.wrap(function *(repo,
                                                     committish,
                                                     newBranch,
                                                     track) {
    assert.instanceOf(repo, NodeGit.Repository);
    if (null !== committish) {
        assert.isString(committish);
    }
    if (null !== newBranch) {
        assert.isString(newBranch);
    }
    assert.isBoolean(track);

    const result = {
        commit: null,
        newBranch: null,
        switchBranch: null,
    };

    const ensureBranchDoesntExist = co.wrap(function *(name) {
        if (null !== (yield GitUtil.findBranch(repo, name))) {
            throw new UserError(`\
A branch named ${colors.red(name)} already exists.`);
        }
    });

    let committishBranch = null;  // the branch corresponding to checkout

    // First, resolve information about `committish`.

    if (null !== committish && null === newBranch && track) {
        // The first of many special cases: the `track` option is used, but
        // we're not making a new branch and do have a target committish.  If
        // `committish` is exactly a remote branch, then we'll specify an
        // operation equivalent to `checkout -b <name> -t <origin>/<name>`,
        // where `committish` is exactly `<origin>/<name>`.

        const tracking = yield exports.validateTrackingBranch(repo,
                                                              committish);
        yield ensureBranchDoesntExist(tracking.branchName);
        result.newBranch = {
            name: tracking.branchName,
            tracking: tracking,
        };
        const branch = yield GitUtil.findRemoteBranch(repo,
                                                      tracking.remoteName,
                                                      tracking.branchName);
        const commit = yield repo.getCommit(branch.target());
        result.commit = commit;
        result.switchBranch = tracking.branchName;
        return result;                                                // RETURN
    }
    else if (null === newBranch && track) {
        throw new UserError(`--track needs branch name`);
    }

    if (null !== committish) {
        // Now, we have a committish to resolve.

        const annotated = yield GitUtil.resolveCommitish(repo, committish);
        if (null === annotated) {

            // If we are not explicitly setting up a tracking branch and are
            // not explicitly createing a new branch, we may implicitly do both
            // when `committish` is not directly resolveable, but does match a
            // single remote tracking branch.

            if (null === newBranch) {
                const remote = yield exports.findTrackingBranch(repo,
                                                                committish);
                if (null !== remote) {
                    // We have a match to a remote; need to look up the commit.

                    const branch = yield GitUtil.findRemoteBranch(repo,
                                                                  remote,
                                                                  committish);
                    const id = branch.target();
                    result.commit = yield repo.getCommit(id);
                    result.newBranch = {
                        name: committish,
                        tracking: {
                            remoteName: remote,
                            branchName: committish,
                        },
                    };
                    result.switchBranch = committish;
                }
            }

            // If we didn't resolve anything from `committish`, throw an error.

            if (null === result.commit) {
                throw new UserError(
                    `Could not resolve ${colors.red(committish)}.`);
            }
        }
        else {

            const commit = yield repo.getCommit(annotated.id());
            result.commit = commit;

            // Check to see if the commit refers to a branch name.

            const branch = yield GitUtil.findBranch(repo, committish);
            if (null !== branch) {
                committishBranch = branch;
                if(!branch.isRemote()) {
                    result.switchBranch = committish;
                }
            }
        }
    }
    else {
        // If we're implicitly using HEAD, see if it's on a branch and record
        // that branch's name.

        const head = yield repo.head();
        if (head.isBranch()) {
            committishBranch = head;
        }
    }

    if (null !== newBranch) {
        // If we have a `newBranch`, we need to make sure it doesn't already
        // exist.

        yield ensureBranchDoesntExist(newBranch);

        // Now, if we're supposed to set up tracking, validate that the
        // committish is a branch.  If it's a tracking branch, then parse the
        // parts.

        let tracking = null;
        if (track) {
            // Set up tracking information of `track` is set.

            if (null === committishBranch) {
                throw new UserError(`\
Cannot setup tracking information; starting point is not a branch.`);
            }

            // If the branch is remote, set up remote tracking information,
            // otherwise leve the remote name 'null';

            if (committishBranch.isRemote()) {
                const parts = committishBranch.shorthand().split("/");
                tracking = {
                    remoteName: parts[0],
                    branchName: parts[1],
                };
            }
            else {
                tracking = {
                    remoteName: null,
                    branchName: committishBranch.shorthand(),
                };
            }
        }

        result.newBranch = {
            name: newBranch,
            tracking: tracking,
        };
        result.switchBranch = newBranch;
    }
    return result;
});

/**
 * In the following order, in the specified `repo`, for the options which are
 * non-null:
 * - check out the specified `commit`
 * - create the specified `newBranch.name` from HEAD
 * - configure the new branch to have the specified `newBranch.tracking`
 *   tracking branch
 * - make the specified `switchBranch` the current branch
 * - overwrite local changes unless `true === force`
 *
 * @param {NodeGit.repository}  repo
 * @param {NodeGit.Commit|null} commit
 * @param {Object|null}         newBranch
 * @param {String}              newBranch.name
 * @param {Object|null}         newBranch.tracking
 * @param {String|null}         newBranch.tracking.remoteName
 * @param {String}              newBranch.tracking.branchName
 * @param {String|null}         switchBranch
 * @param {Boolean}             force
 */
exports.executeCheckout = co.wrap(function *(repo,
                                             commit,
                                             newBranch,
                                             switchBranch,
                                             force) {
    assert.instanceOf(repo, NodeGit.Repository);
    if (null !== commit) {
        assert.instanceOf(commit, NodeGit.Commit);
    }
    if (null !== newBranch) {
        assert.isObject(newBranch);
        assert.isString(newBranch.name);
        if (null !== newBranch.tracking) {
            assert.isObject(newBranch.tracking);
            if (null !== newBranch.tracking.remoteName) {
                assert.isString(newBranch.tracking.remoteName);
            }
            assert.isString(newBranch.tracking.branchName);
        }
    }
    if (null !== switchBranch) {
        assert.isString(switchBranch);
    }
    assert.isBoolean(force);

    // attempt the checkout first.

    if (null !== commit) {
        yield exports.checkoutCommit(repo, commit, force);
    }
    if (null !== newBranch) {
        const name = newBranch.name;
        const branch = yield GitUtil.createBranchFromHead(repo, name);
        const tracking = newBranch.tracking;
        if (null !== tracking) {
            const trackingName = tracking.branchName;
            const remote = tracking.remoteName;
            let trackingBranchName;
            if (null !== remote) {
                trackingBranchName = `${remote}/${trackingName}`;
            }
            else {
                trackingBranchName = trackingName;
            }
            yield NodeGit.Branch.setUpstream(branch, trackingBranchName);
        }
    }
    if (null !== switchBranch) {
        yield repo.setHead(`refs/heads/${switchBranch}`);
    }
});
