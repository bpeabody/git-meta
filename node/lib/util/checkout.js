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

const GitUtil       = require("./git_util");
const RepoStatus    = require("./repo_status");
const SubmoduleUtil = require("./submodule_util");
const UserError     = require("./user_error");

/**
 * Checkout the branch having the specified `branchName` in the specified
 * `metaRepo` having the specified `metaStatus` and all visible sub-repos.  If
 * the specified `create` is "all" then the behavior is undefined if any repo
 * already has a branch named `branchName`.  If `create` is "none" then throw a
 * `UserError` unless all repos have a branch named `branchName`.  The behavior
 * is undefined unless `create === "none" || create === "some" || create ===
 * "all"`.
 *
 * @async
 * @param {NodeGit.Repository} repo
 * @param {RepoStatus}         metaStatus
 * @param {String}             branchName
 * @param {String}             create
 */
exports.checkout = co.wrap(function *(metaRepo,
                                      metaStatus,
                                      branchName,
                                      create) {
    assert.instanceOf(metaRepo, NodeGit.Repository);
    assert.instanceOf(metaStatus, RepoStatus);
    assert.isString(branchName);
    assert.isString(create);

    const submodules = metaStatus.submodules;
    const openSubNames = Object.keys(submodules).filter(
        name => null !== submodules[name].repoStatus
    );
    const openSubRepos = yield openSubNames.map(
        name => SubmoduleUtil.getRepo(metaRepo, name)
    );

    /**
     * Checkout the branch in the specified `repo`.  Create it if it can't be
     * found.
     */
    const checkout = co.wrap(function *(repo, status) {
        if (status.currentBranchName === branchName) {
            return;                                                   // RETURN
        }
        if (null === (yield GitUtil.findBranch(repo, branchName))) {
            const head = yield repo.getCommit(status.headCommit);
            yield repo.createBranch(branchName,
                                    head,
                                    0,
                                    repo.defaultSignature());
        }

        // Do a force because (a) we've already validated that there are no
        // changes and (b) it won't change the branch in the meta repo
        // otherwise.

        yield repo.checkoutBranch(branchName, {
            checkoutStrategy: NodeGit.Checkout.STRATEGY.FORCE,
        });
    });

    /**
     * Validate the specified `repo` and fail using the specified `description`
     * if `repo` is not in the correct state according to the `create`
     * parameter.
     */
    const validate = co.wrap(function *(repo, description) {
        const branch = yield GitUtil.findBranch(repo, branchName);
        if (null !== branch && create === "all") {
            throw new UserError(`
${description} already has a branch named ${colors.red(branchName)}.`);
        }
        if (null === branch && create === "none") {
            throw new UserError(`
${description} does not have a branch named ${colors.red(branchName)}.`);
        }
    });

    // Skip validation if `"some" === create` because every configuration is
    // valid in that case.

    if ("some" !== create) {
        let validators = openSubNames.map(
            (sub, i) => validate(openSubRepos[i], sub)
        );
        validators.push(validate(metaRepo, "The meta-repo"));
        yield validators;
    }

    // TODO: I believe there is a bug in nodegit/libgit2 somewhere that results
    // in a crash 

    for (let i = 0; i < openSubNames.length; ++i) {
        const sub = openSubNames[i];
        yield checkout(openSubRepos[i], submodules[sub].repoStatus);
    }

    yield checkout(metaRepo, metaStatus);
});