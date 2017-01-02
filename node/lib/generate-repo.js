#!/usr/bin/env node
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

const ArgumentParser = require("argparse").ArgumentParser;
const co             = require("co");
const NodeGit        = require("nodegit");
const rimraf         = require("rimraf");

const RepoAST             = require("./util/repo_ast");
const Stopwatch           = require("./util/stopwatch");
const WriteRepoASTUtil    = require("./util/write_repo_ast_util");

const description = `Write the repos described by a string having the syntax \
described in ./util/shorthand_parser_util.`;

const parser = new ArgumentParser({
    addHelp: true,
    description: description
});

parser.addArgument(["destination"], {
    type: "string",
    help: "directory to create repository in",
});

parser.addArgument(["-o", "--overwrite"], {
    required: false,
    action: "storeConst",
    constant: true,
    help: `automatically remove existing directories`,
});

parser.addArgument(["-c", "--count"], {
    required: false,
    defaultValue: -1,
    type: "int",
    help: "number of meta-repo commit block iterations, omit to go forever",
});

parser.addArgument(["-b", "--block-size"], {
    required: false,
    defaultValue: 100,
    type: "int",
    help: "number of commits to write at once",
});

const args = parser.parseArgs();

/**
 * Return a random integer in the range of [0, max).
 * 
 * @param {Number} max
 * @return {Number}
 */
function randomInt(max) {
    return Math.floor(Math.random() * max);
}

const baseChar = "a".charCodeAt(0);

function generateCharacter() {
    return String.fromCharCode(baseChar + randomInt(26));
}

function generatePath(depth) {
    let result = "";
    for (let i = 0; i < depth; ++i) {
        if (0 !== i) {
            result += "/";
        }
        result += (generateCharacter() + generateCharacter());
    }
    // Make leaves have three characters so they're always distinct from
    // directories.

    return result + generateCharacter();
}


class State {
    constructor() {
        this.renderCache      = {};     // used in writing commits
        this.oldCommitMap     = {};     // maps logical to physical sha
        this.commits          = {};     // logical sha to RepoAST.Commit
        this.submoduleNames   = [];     // paths of all subs
        this.submoduleHeads   = {};     // map to last sub commit
        this.metaHead         = null;   // array of shas
        this.nextCommitId     = 2;
    }

    generateCommitId() {
        return "" + this.nextCommitId++;
    }
}

function makeSubCommits(state, name, madeShas) {
    const numCommits = randomInt(3) + 1;
    const subHeads = state.submoduleHeads;
    let lastHead = subHeads[name];
    const commits = state.commits;
    for (let i = 0; i < numCommits; ++i) {
        const newHead = state.generateCommitId();
        let changes = {};

        // If this subrepo already has changes, we'll go back and update a few
        // of them at random.

        if (undefined !== lastHead) {
            const oldChanges = RepoAST.renderCommit(state.renderCache,
                                                    commits,
                                                    lastHead);
            const paths = Object.keys(oldChanges);
            const numChanges = randomInt(4) + 1;
            for (let j = 0; j < numChanges; ++j) {
                const pathToUpdate = paths[randomInt(paths.length)];
                changes[pathToUpdate] =
                                      state.nextCommitId + generateCharacter();
            }
        }

        // Add a path if there are no commits yet, or on a 1/3 chance

        if (undefined === lastHead || 0 === randomInt(3)) {
            const path = generatePath(randomInt(7) + 1);
            changes[path] = state.nextCommitId + generateCharacter();
        }
        const parents = undefined === lastHead ? [] : [lastHead];
        lastHead = newHead;
        subHeads[name] = newHead;
        const commit = new RepoAST.Commit({
            parents: parents,
            changes: changes,
            message: `a random commit for sub ${name}, #${newHead}`,
        });
        madeShas.push(newHead);
        commits[newHead] = commit;
    }
    return lastHead;
}

/**
 * Generate commits in the specified `state`, storing in the specified
 * `metaShas` all generated commit ids and in the specified `subHeads` the
 * shas of submodule heads referenced by meta-repo commits.
 *
 * @param {State}     state
 * @param {String []} madeShas
 * @param {String []} subHeads
 */
function makeMetaCommit(state, madeShas, subHeads) {
    const subsToChange = randomInt(3) + 1;
    let subPaths = {};
    const numSubs = state.submoduleNames.length;

    if (0 !== numSubs) {
        // randomly pick subs to modify

        for (let i = 0; i < subsToChange; ++i) {
            const index = randomInt(numSubs);
            const name = state.submoduleNames[index];
            if (!(name in subPaths)) {
                subPaths[name] = true;
            }
        }
    }

    // one commit in five add a sub or always if no subs

    if (0 === numSubs || 0 === randomInt(5)) {
        while (true) {
            const path = generatePath(3);
            if (!(path in state.submoduleHeads)) {
                subPaths[path] = true;
                state.submoduleNames.push(path);
                break;
            }
        }
    }

    const changes = {};
    Object.keys(subPaths).forEach(function (path) {
        const newHead = makeSubCommits(state, path, madeShas);
        changes[path] = new RepoAST.Submodule(".", newHead);
        subHeads.push(newHead);
    });
    const commitId = state.generateCommitId();
    const lastHead = state.metaHead;
    state.metaHead = commitId;
    const parents = lastHead === null ? [] : [lastHead];
    const commit = new RepoAST.Commit({
        parents: parents,
        changes: changes,
        message: `a friendly meta commit, #${commitId}`,
    });
    state.commits[commitId] = commit;
    madeShas.push(commitId);
}

const renderRefs = co.wrap(function *(repo, oldCommitMap, shas) {
    yield shas.map(sha => {
        const target = oldCommitMap[sha];
        const targetId = NodeGit.Oid.fromString(target);
        return NodeGit.Reference.create(repo,
                                        `refs/commits/${target}`,
                                        targetId,
                                        0,
                                        "meta-ref");
    });
});

const renderBlock = co.wrap(function *(repo, state, shas, subHeads) {
    yield WriteRepoASTUtil.writeCommits(state.oldCommitMap,
                                        state.renderCache,
                                        repo,
                                        state.commits,
                                        shas);
    yield renderRefs(repo, state.oldCommitMap, subHeads);
});

co(function *() {
    try {
        const path = args.destination;
        if (args.overwrite) {
            const timer = new Stopwatch();
            process.stdout.write("Removing old files... ");
            yield (new Promise(callback => {
                return rimraf(path, {}, callback);
            }));
            process.stdout.write(`took ${timer.elapsed} seconds.\n`);
        }
        const count = args.count;
        const blockSize = args.block_size;
        const state = new State();
        console.log(`Generating ${count < 0 ? "infinite" : count} blocks of \
${blockSize} commits.`);
        const totalTime = new Stopwatch();
        const repo = yield NodeGit.Repository.init(path, 1);
        let totalCommits = 0;
        for (let i = 0; -1 === count || i < count; ++i) {
            const time = new Stopwatch();
            process.stdout.write(`Generating ${blockSize} meta commits... `);
            const madeShas = [];
            const subHeads = [];
            for (let i = 0; i < blockSize; ++i) {
                makeMetaCommit(state, madeShas, subHeads);
            }
            totalCommits += blockSize;
            process.stdout.write(`took ${time.elapsed}.\n`);
            yield renderBlock(repo, state, madeShas, subHeads);
            process.stdout.write(`Writing ${madeShas.length} commits and \
${subHeads.length} sub changes, took ${time.elapsed} seconds.  Commit \
rate ${totalCommits / totalTime.elapsed}/S.\n`);
        }
    }
    catch(e) {
        console.error(e.stack);
    }
});
