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
 * This module contains utilities for configuring submodules.  Eventually all
 * this should go away and we should submit patches to libgit2/nodegit.  The
 * reasons we need these methods are:
 *
 * - speed: the Submodule methods are slow
 * - locking: the Submodule methods make unnecessary locks and don't work
 *   in parallel
 * - correctness: once we start doing some of the manipulation ourselves, the
 *   data is not recorded in libgit's caches and so we must do all Submodule
 *   work ourselves.
 *
 * @module {SubmoduleConfigUtil}
 */

const assert  = require("chai").assert;
const co      = require("co");
const fs      = require("fs-promise");
const NodeGit = require("nodegit");
const path    = require("path");

const CONFIG_FILE_NAME = "config";

/**
 * @module {SubmoduleConfigUtil}
 *
 * This module contains utilties for processing submodule configuration data.
 */

/**
 * name of the modules configuration file
 *
 * @static
 * @property {String}
 */
exports.modulesFileName = ".gitmodules";

/**
 * Return the result of resolving the specified `relativeUrl` onto the
 * specified `baseUrl`.
 *
 * @param {String} baseUrl
 * @param {String} relativeUrl
 * @return {String}
 */
exports.resolveUrl = function (baseUrl, relativeUrl) {
    assert.isString(baseUrl);
    assert.isString(relativeUrl);
    assert(relativeUrl.startsWith("../") || relativeUrl.startsWith("./"));

    // This is a pretty naive algorithm, but it should be good enough for most
    // cases.  List all elements of the baseUrl and the relativeUrl that are
    // in-between "/" characters.  Walk through the elements of 'relative',
    // throwing away "." and ".." elements, and popping the last element of the
    // base list whenever a ".." is found.  Afterwards, join the elements of
    // these lists together with "/".

    let base = baseUrl.split("/");
    let relative = relativeUrl.split("/");
    while (0 !== relative.length) {
        if (".." === relative[0]) {
            base.pop();
            relative.shift();
        }
        else if ("." === relative[0]) {
            relative.shift();
        }
        else {
            break;  // Once no more relative operators, quit.
        }
    }
    return base.concat(relative).join("/");
};

/**
 * If the specified `submoduleUrl` is a relative path, return the result of
 * resolving it onto the specified `baseUrl`; otherwise, return `submoduleURL`.
 *
 * @param {String} baseUrl
 * @param {String} submoduleUrl
 * @return {String}
 */
exports.resolveSubmoduleUrl = function (baseUrl, submoduleUrl) {
    assert.isString(baseUrl);
    assert.isString(submoduleUrl);
    if (submoduleUrl.startsWith("./") || submoduleUrl.startsWith("../")) {
        return exports.resolveUrl(baseUrl, submoduleUrl);
    }
    return submoduleUrl;
};

/**
 * Return a map from submodule name to url from the specified `text`.
 * @param {String} text
 */
exports.parseSubmoduleConfig = function (text) {
    assert.isString(text);

    const nameRe = /\[submodule *"(.*)"]/;
    const urlRe  = /^[ \t]*url = (.*)$/;
    let result = {};
    const lines = text.split("\n");
    let lastName = null;
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i];
        const nameParseResult = nameRe.exec(line);
        if (null !== nameParseResult) {
            lastName = nameParseResult[1];
        }
        else if (null !== lastName) {
            const urlParseResult = urlRe.exec(line);
            if (null !== urlParseResult) {
                result[lastName] = urlParseResult[1];
            }
        }
    }
    return result;
};

/**
 * Return an array containing the names of the submodules listed in the
 * specified text, formatted as from a `.git/config` file.
 *
 * @param {String} text
 * @return {String[]}
 */
exports.parseOpenSubmodules = function (text) {
    assert.isString(text);

    const regex = /\[submodule *"(.*)"]/;
    const lines = text.split("\n");
    const result = [];
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i];
        const parseResult = regex.exec(line);
        if (null !== parseResult) {
            result.push(parseResult[1]);
        }
    }
    return result;
};

/**
 * Return a map from submodule name to url at the specified `commit` in the
 * specified `repo`.
 *
 * @private
 * @async
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Commit}     commit
 * @return {Object} map from name to url
 */
exports.getSubmodulesFromCommit = co.wrap(function *(repo, commit) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);

    const tree = yield commit.getTree();
    let entry;
    try {
        entry = yield tree.entryByPath(exports.modulesFileName);
    }
    catch (e) {
        // No modules file.
        return {};
    }
    const oid = entry.oid();
    const blob = yield repo.getBlob(oid);
    const data = blob.toString();
    return exports.parseSubmoduleConfig(data);
});

/**
 * Return a map from submodule name to url in the specified `repo`.
 *
 * @private
 * @async
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Index}      index
 * @return {Object} map from name to url
 */
exports.getSubmodulesFromIndex = co.wrap(function *(repo, index) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(index, NodeGit.Index);

    const entry = index.getByPath(exports.modulesFileName);
    if (undefined === entry) {
        return {};                                                    // RETURN
    }
    const oid = entry.id;
    const blob = yield repo.getBlob(oid);
    const data = blob.toString();
    return  exports.parseSubmoduleConfig(data);
});

/**
 * Return the path to the config file for the specified `repo`.
 *
 * @param {NodeGit.Repository}
 * @return {String}
 */
exports.getConfigPath = function (repo) {
    assert.instanceOf(repo, NodeGit.Repository);
    return path.join(repo.path(), CONFIG_FILE_NAME);
};

/**
 * Return the text for the lines to configure the submodule having the
 * specified `name` to point to the specified `url`.
 *
 * @param {String} name
 * @param {String} url
 * @return {String}
 */
exports.getConfigLines = function (name, url) {
    assert.isString(name);
    assert.isString(url);
    return `\
[submodule "${name}"]
\turl = ${url}
`;
};

/**
 * Write the entry to set up the the submodule having the specified `name` to
 * and `url` to the `.git/config` file for the repo at the specified
 * `repoPath`.
 *
 * @async
 * @param {NodeGit.Repository} repo
 * @param {String}             name
 * @param {String}             url
 *
 * @async
 * @param {String} repoPath
 * @param {String} name
 * @param {String} url
 */
exports.initSubmodule = co.wrap(function *(repoPath, name, url) {
    assert.isString(repoPath);
    assert.isString(name);
    assert.isString(url);
    const configPath = path.join(repoPath, ".git", CONFIG_FILE_NAME);
    const lines = exports.getConfigLines(name, url);

    // Do this sync to avoid race conditions for now.

    fs.appendFileSync(configPath, lines);
    yield (Promise.resolve());  // empty yield to avoid warning.
});

/**
 * Open the submodule having the specified `name` and `url` for the repo at the
 * specified `repoPath`.  Configure the repository for this submodule to have
 * `url` as its remote, unless `url` is relative, in which case resolve `url`
 * against the specified `repoUrl`.  Return the newly opened repository.  Note
 * that this command does not fetch any refs from the remote for this
 * submodule, and while its repo can be opened it will be empty.
 *
 * @async
 * @param {String} repoUrl
 * @param {String} repoPath
 * @param {String} name
 * @param {String} url
 * @return {NodeGit.Repository}
 */
exports.initSubmoduleAndRepo = co.wrap(function *(repoUrl,
                                                  repoPath,
                                                  name,
                                                  url) {
    assert.isString(repoPath);
    assert.isString(name);
    assert.isString(url);

    // Update the `.git/config` file.

    yield exports.initSubmodule(repoPath, name, url);

    // Then, initializee the repository.  We pass `initExt` the right set of
    // flags so that it will set it up as a git link.

    // From repository.h

    const NO_DOTGIT_DIR    = 1 << 2;
    const MKPATH           = 1 << 4;
    const RELATIVE_GITLINK = 1 << 6;

    const subRepoDir = path.join(repoPath, ".git", "modules", name);

    // Put the right number of dots based on the depth of `name`, e.g.,
    // "foo/bar/bam" needs two more sets of dots than "foo".

    let workdirPath = "../../../";
    const extraDepth = name.split("/").length - 1;
    for (let i = 0; i < extraDepth; ++i) {
        workdirPath += "../";
    }
    workdirPath += name;

    const realUrl = exports.resolveSubmoduleUrl(repoUrl, url);

    return yield NodeGit.Repository.initExt(subRepoDir, {
        originUrl: realUrl,
        workdirPath: workdirPath,
        flags: NO_DOTGIT_DIR | MKPATH | RELATIVE_GITLINK,
    });
});
