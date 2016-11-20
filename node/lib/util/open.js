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

/**
 * This module contains methods for opening repositories.
 */
const assert  = require("chai").assert;
const NodeGit = require("nodegit");
const co      = require("co");

const GitUtil             = require("./git_util");
const SubmoduleConfigUtil = require("./submodule_config_util");

/**
 * Open the submodule having the specified `submoduleName` in the specified
 * `repo`; fetch the specified `commitSha` and set HEAD to point to it.
 * 
 * configure it to be checked out on the specified `branchName` on the
 * specified `commitSha`.
 *
 * @async
 * @param {String} repoOriginUrl
 * @param {String} repoPath
 * @param {String} submoduleName
 * @param {String} url
 * @param {String} commitSha
 * @return {NodeGit.Repository}
 */
exports.openOnCommit = co.wrap(function *(repoOriginUrl,
                                          repoPath,
                                          submoduleName,
                                          url,
                                          commitSha) {
    assert.isString(repoPath);
    assert.isString(repoOriginUrl);
    assert.isString(submoduleName);
    assert.isString(url);
    assert.isString(commitSha);

    // Set up the submodule.

    const submoduleRepo = yield SubmoduleConfigUtil.initSubmoduleAndRepo(
                                                                repoOriginUrl,
                                                                repoPath,
                                                                submoduleName,
                                                                url);

    // Fetch the needed sha.

    yield GitUtil.fetchSha(submoduleRepo, commitSha);

    // Check out HEAD

    submoduleRepo.setHeadDetached(commitSha);
    const commit = yield submoduleRepo.getCommit(commitSha);
    yield NodeGit.Reset.reset(submoduleRepo, commit, NodeGit.Reset.TYPE.HARD);

    return submoduleRepo;
});
