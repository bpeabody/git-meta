/*
 * Copyright (c) 2018, Two Sigma Open Source
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

const assert  = require("chai").assert;
const co      = require("co");
const colors  = require("colors");
const mkdirp    = require("mkdirp");
const NodeGit = require("nodegit");
const path    = require("path");
const rimraf  = require("rimraf");

const ConflictUtil        = require("./conflict_util");
const DeinitUtil          = require("./deinit_util");
const DoWorkQueue         = require("./do_work_queue");
const GitUtil             = require("./git_util");
const Open                = require("./open");
const RebaseUtil          = require("./rebase_util");
const Reset               = require("./reset");
const SequencerState      = require("./sequencer_state");
const SequencerStateUtil  = require("./sequencer_state_util");
const StatusUtil          = require("./status_util");
const Submodule           = require("./submodule");
const SubmoduleConfigUtil = require("./submodule_config_util");
const SubmoduleUtil       = require("./submodule_util");
const TreeUtil            = require("./tree_util");
const UserError           = require("./user_error");

const CommitAndRef = SequencerState.CommitAndRef;
const CHERRY_PICK = SequencerState.TYPE.CHERRY_PICK;

/**
 * Throw a `UserError` if the specfied `seq` is null or does not indicate a
 * cherry-pick.
 *
 * @param {SequencerState|null} seq
 */
function ensureCherryInProgress(seq) {
    if (null !== seq) {
        assert.instanceOf(seq, SequencerState);
    }
    if (null === seq || CHERRY_PICK !== seq.type) {
        throw new UserError("No cherry-pick in progress.");
    }
}

/**
 * Change the specified `submodules` in the specified index.  If a name maps to
 * a `Submodule`, update it in the specified `index` in the specified `repo`
 * and if that submodule is open, reset its HEAD, index, and worktree to
 * reflect that commit.  Otherwise, if it maps to `null`, remove it and deinit
 * it if it's open.  Obtain submodule repositories from the specified `opener`.
 *  The behavior is undefined if any referenced submodule is open and has index
 *  or workdir modifications.
 *
 * @param {NodeGit.Repository} repo
 * @param {Open.Opener}        opener
 * @param {NodeGit.Index}      index
 * @param {Object}             submodules    name to Submodule
 */
exports.changeSubmodules = co.wrap(function *(repo,
                                              opener,
                                              index,
                                              submodules) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(opener, Open.Opener);
    assert.instanceOf(index, NodeGit.Index);
    assert.isObject(submodules);
    if (0 === Object.keys(submodules).count) {
        return;                                                       // RETURN
    }
    const urls = yield SubmoduleConfigUtil.getSubmodulesFromIndex(repo, index);
    const changes = {};
    function rmrf(dir) {
        return new Promise(callback => {
            return rimraf(path.join(repo.workdir(), dir), {}, callback);
        });
    }
    const fetcher = yield opener.fetcher();
    for (let name in submodules) {
        const sub = submodules[name];
        if (null === sub) {
            yield DeinitUtil.deinit(repo, name);
            changes[name] = null;
            delete urls[name];
            yield rmrf(name);
        }
        else if (yield opener.isOpen(name)) {
            const subRepo = yield opener.getSubrepo(name);
            yield fetcher.fetchSha(subRepo, name, sub.sha);
            const commit = yield subRepo.getCommit(sub.sha);
            yield GitUtil.setHeadHard(subRepo, commit);
            yield index.addByPath(name);
        } else {
            changes[name] = new TreeUtil.Change(
                                            NodeGit.Oid.fromString(sub.sha),
                                            NodeGit.TreeEntry.FILEMODE.COMMIT);
            urls[name] = sub.url;
            const subPath = path.join(repo.workdir(), name);
            mkdirp.sync(subPath);
        }
    }
    const parentTreeId = yield index.writeTree();
    const parentTree = yield repo.getTree(parentTreeId);
    const newTree = yield TreeUtil.writeTree(repo, parentTree, changes);
    yield index.readTree(newTree);
    yield SubmoduleConfigUtil.writeUrls(repo, index, urls);
});

/**
 * Return true if the specified `commit` in the specified `repo` contains any
 * URL changes and false otherwise.  A URL change is an alteration to a
 * submodule's URL in the `.gitmodules` file that is not an addition or
 * removal.
 *
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Commit}     commit
 * @return {Bool}
 */
exports.containsUrlChanges = co.wrap(function *(repo, commit) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);

    let parentUrls = {};
    const parents = yield commit.getParents();
    if (0 !== parents.length) {
        parentUrls =
           yield SubmoduleConfigUtil.getSubmodulesFromCommit(repo, parents[0]);
    }
    const commitUrls =
               yield SubmoduleConfigUtil.getSubmodulesFromCommit(repo, commit);
    for (let name in parentUrls) {
        const parentUrl = parentUrls[name];
        const commitUrl = commitUrls[name];
        if (undefined !== commitUrl && parentUrl !== commitUrl) {
            return true;                                              // RETURN
        }
    }
    return false;
});

/**
 * Return the entry for the specified `path` in the optionally specified `tree`
 * or null if `null === tree` or `path` does not exist in `tree`.
 *
 * @param {NodeGit.Tree|null} tree
 * @param {String}            path
 * @return {NodeGit.TreeEntry}
 */
const getTreeEntry = co.wrap(function *(tree, path) {
    if (null === tree) {
        return null;
    }
    try {
        return yield tree.entryByPath(path);
    } catch (e) {
        // only way to tell if entry doesn't exist
    }
    return null;
});

/**
 * Return the tree corresponding to the merge-base for the specified `lhs` and
 * `rhs` commits in the specified `repo`, or null if there is no ancestor
 * commit in common between `lhs` and `rhs`.
 *
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Commit} lhs
 * @param {NodeGit.Commit} rhs
 * @return {NodeGit.Tree|null}
 */
const getMergeBaseTree = co.wrap(function *(repo, lhs, rhs) {
    const baseSha = yield GitUtil.getMergeBase(repo, lhs, rhs);
    if (null !== baseSha) {
        const mergeBase = yield repo.getCommit(baseSha);
        return yield mergeBase.getTree();
    }
    return null;
});

/**
 * Determine how to apply the submodule changes introduced in the
 * specified `commit` to the commit on the head of the specified `repo`.
 * Return an object describing what changes to make, including which submodules
 * cannot be updated at all due to a conflicts, such as a change being
 * introduced to a submodule that does not exist in HEAD.  Throw a `UserError`
 * if non-submodule changes are detected.
 *
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Commit}     commit
 * @return {Object} return
 * @return {Object} return.changes        from sub name to `SubmoduleChange`
 * @return {Object} return.simpleChanges  from sub name to `Submodule` or null
 * @return {Object} return.conflicts map  from sub name to `Conflict`
 */
exports.computeChanges = co.wrap(function *(repo, commit) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);
    const head = yield repo.getHeadCommit();
    const headTree = yield head.getTree();
    const baseTree = yield getMergeBaseTree(repo, head, commit);
    const changes = yield SubmoduleUtil.getSubmoduleChanges(repo,
                                                            commit,
                                                            false);
    const urls = yield SubmoduleConfigUtil.getSubmodulesFromCommit(repo,
                                                                   commit);
    const result = {
        changes: {},
        simpleChanges: {},
        conflicts: {},
    };

    const ConflictEntry = ConflictUtil.ConflictEntry;
    const Conflict = ConflictUtil.Conflict;
    const FILEMODE = NodeGit.TreeEntry.FILEMODE;

    yield Object.keys(changes).map(co.wrap(function *(sub) {
        const change = changes[sub];
        const headEntry = yield getTreeEntry(headTree, sub);

        const makeConflict = co.wrap(function *() {
            const baseEntry = yield getTreeEntry(baseTree, sub);
            let ancestor = null;
            if (null !== baseEntry) {
                ancestor = new ConflictEntry(baseEntry.filemode(),
                                             baseEntry.sha());
            }
            let our = null;
            if (null !== headEntry) {
                our = new ConflictEntry(headEntry.filemode(), headEntry.sha());
            }
            let their = null;
            if (null !== change.newSha) {
                their = new ConflictEntry(FILEMODE.COMMIT, change.newSha);
            }
            return new Conflict(ancestor, our, their);
        });

        if (null === headEntry) {
            // If doesn't exist on HEAD, only valid change is an addition;
            // ignore a removal.

            if (null === change.oldSha) {
                result.simpleChanges[sub] = new Submodule(urls[sub],
                                                          change.newSha);
            } else if (null !== change.newSha) {
                result.conflicts[sub] = yield makeConflict();
            }
        } else if (FILEMODE.COMMIT !== headEntry.filemode()) {
            // If the path on HEAD is not a submodule, we have a conflict.

            result.conflicts[sub] = yield makeConflict();
        } else if (null === change.oldSha) {
            // We have an addition.  We've already covered the case where this
            // sub doesn't exist on head, so it's going to be a conflict unless
            // the SHA on HEAD is the same.

            if (headEntry.sha() !== change.newSha) {
                result.conflicts[sub] = yield makeConflict();
            }
        } else if (null === change.newSha) {
            // Register a deletion unless the SHA was changed on HEAD.

            if (headEntry.sha() === change.oldSha) {
                result.simpleChanges[sub] = null;
            } else {
                result.conflicts[sub] = yield makeConflict();
            }
        } else if (change.newSha !== headEntry.sha()) {
            // Finally, we have a normal update, new commits in the submodule.
            // We still deem it to be a "simple" change not needing a
            // cherry-pick if the old sha for the change is the same as that on
            // head.

            if (change.oldSha === headEntry.sha()) {
                result.simpleChanges[sub] = new Submodule(urls[sub],
                                                          change.newSha);
            } else {
                result.changes[sub] = change;
            }
        }
    }));
    return result;
});

/**
 * Pick the specified `subs` in the specified `metaRepo` having the specified
 * `metaIndex`.  Stage new submodule commits in `metaRepo`.  Return an object
 * describing any commits that were generated and conflicted commits.  Use the
 * specified `opener` to open submodules.
 *
 * @param {NodeGit.Repository} metaRepo
 * @param {Open.Opener}        opener
 * @param {NodeGit.Index}      metaIndex
 * @param {Object}             subs        map from name to SubmoduleChange
 * @return {Object}
 * @return {Object} return.commits    map from name to map from new to old ids
 * @return {Object} return.conflicts  map from name to commit causing conflict
 */
exports.pickSubs = co.wrap(function *(metaRepo, opener, metaIndex, subs) {
    assert.instanceOf(metaRepo, NodeGit.Repository);
    assert.instanceOf(opener, Open.Opener);
    assert.instanceOf(metaIndex, NodeGit.Index);
    assert.isObject(subs);
    const result = {
        commits: {},
        conflicts: {},
    };
    const fetcher = yield opener.fetcher();
    const pickSub = co.wrap(function *(name) {
        const repo = yield opener.getSubrepo(name);
        const change = subs[name];
        const commitText = "(" + GitUtil.shortSha(change.oldSha) + ".." +
            GitUtil.shortSha(change.newSha) + "]";
        console.log(`Sub-repo ${colors.blue(name)}: cherry-picking commits \
${colors.green(commitText)}.`);

        // Fetch the commit; it may not be present.
        yield fetcher.fetchSha(repo, name, change.newSha);
        yield fetcher.fetchSha(repo, name, change.oldSha);
        const newCommit = yield repo.getCommit(change.newSha);
        const oldCommit = yield repo.getCommit(change.oldSha);
        const rewriteResult = yield RebaseUtil.rewriteCommits(repo,
                                                              newCommit,
                                                              oldCommit);
        result.commits[name] = rewriteResult.commits;
        yield metaIndex.addByPath(name);
        if (null !== rewriteResult.conflictedCommit) {
            result.conflicts[name] = rewriteResult.conflictedCommit;
        }
    });
    yield DoWorkQueue.doInParallel(Object.keys(subs), pickSub);
    return result;
});

/**
 * Write the specified `conflicts` to the specified `index` in the specified
 * `repo`.  If `conflicts` is non-empty, return a non-empty string desribing
 * them.  Otherwise, return the empty string.
 *
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Index}      index
 * @param {Object}             conflicts  from sub name to `Conflict`
 * @return {String}
 */
exports.writeConflicts = co.wrap(function *(repo, index, conflicts) {
    let errorMessage = "";
    const names = Object.keys(conflicts).sort();
    for (let name of names) {
        yield ConflictUtil.addConflict(index, name, conflicts[name]);
        errorMessage += `\
Conflicting entries for submodule ${colors.red(name)}
`;
    }
    return errorMessage;
});

/**
 * Finish the cherry-pick in progress in the specified `repo` having the
 * specified `index`.  Use the message and signature from the specified
 * original `commit`.  Return the sha of the newly-created commit.
 *
 * @param {NodeGit.Repository} repo
 * @param {NodeGit.Index}      index
 * @param {NodeGit.Commit}     commit
 * @return {String}
 */
const finish = co.wrap(function *(repo, commit) {
    assert.instanceOf(repo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);

    const defaultSig = repo.defaultSignature();
    const metaCommit = yield repo.createCommitOnHead([],
                                                     defaultSig,
                                                     commit.committer(),
                                                     commit.message());
    yield SequencerStateUtil.cleanSequencerState(repo.path());
    console.log("Cherry-pick complete.");
    return metaCommit.tostrS();
});

/**
 * Cherry-pick the specified `commit` in the specified `metaRepo`.  Return an
 * object with the cherry-picked commits ids.  This object contains the id of
 * the newly-generated meta-repo commit and for each sub-repo, a map from
 * new (cherry-pick) sha to the original commit sha.  Throw a `UserError` if
 * the repository is not in a state that can allow a cherry-pick (e.g., it's
 * rebasing), if `commit` contains changes that we cannot cherry-pick (e.g.,
 * URL-only changes), or if the cherry-pick would result in no changes (TODO:
 * provide support for '--allow-empty' if needed).  If the cherry-pick is
 * initiated but results in a conflicts, the `errorMessage` of the returned
 * object will be non-null and will contain a description of the conflicts.
 *
 * @async
 * @param {NodeGit.Repository} metaRepo
 * @param {NodeGit.Commit}     commit
 * @return {Object}      return
 * @return {String}      return.newMetaCommit
 * @return {Object}      returm.submoduleCommits
 * @return {String|null} return.errorMessage
 */
exports.cherryPick = co.wrap(function *(metaRepo, commit) {
    assert.instanceOf(metaRepo, NodeGit.Repository);
    assert.instanceOf(commit, NodeGit.Commit);

    const status = yield StatusUtil.getRepoStatus(metaRepo);
    StatusUtil.ensureReady(status);

    // First, perform sanity checks to see if the repo is in a state that we
    // can pick in and if `commit` is something that we can pick.

    if (!status.isDeepClean(false)) {
        // TODO: Git will refuse to run if there are staged changes, but will
        // attempt a cherry-pick if there are just workdir changes.  We should
        // support this in the future, but it basically requires us to dry-run
        // the rebases in all the submodules, and I'm uncertain how to do that
        // at the moment.

        throw new UserError(`\
The repository has uncommitted changes.  Please stash or commit them before
running cherry-pick.`);
    }

    const hasUrlChanges = yield exports.containsUrlChanges(metaRepo, commit);
    if (hasUrlChanges) {
        // TODO: Dealing with these would be a huge hassle and is probably not
        // worth it at the moment since the recommended policy for monorepo
        // implementations is to prevent users from making URL changes anyway.

        throw new UserError(`\
Cherry-picking commits with submodule URL changes is not currently supported.
Please try with normal 'git cherry-pick'.`);
    }

    const changes = yield exports.computeChanges(metaRepo, commit);
    const metaIndex = yield metaRepo.index();

    // We're going to attempt a cherry-pick if we've made it this far, record a
    // cherry-pick file.

    const head = yield metaRepo.getHeadCommit();
    const seq = new SequencerState({
        type: CHERRY_PICK,
        originalHead: new CommitAndRef(head.id().tostrS(), null),
        target: new CommitAndRef(commit.id().tostrS(), null),
        currentCommit: 0,
        commits: [commit.id().tostrS()],
    });
    yield SequencerStateUtil.writeSequencerState(metaRepo.path(), seq);

    const opener = new Open.Opener(metaRepo, null);

    // Perform simple changes that don't require picks -- addition, deletions,
    // and fast-forwards.

    yield exports.changeSubmodules(metaRepo,
                                   opener,
                                   metaIndex,
                                   changes.simpleChanges);

    // Render any conflicts

    let errorMessage =
          yield exports.writeConflicts(metaRepo, metaIndex, changes.conflicts);

    // Then do the cherry-picks.

    const picks = yield exports.pickSubs(metaRepo,
                                         opener,
                                         metaIndex,
                                         changes.changes);

    const conflicts = picks.conflicts;
    Object.keys(conflicts).sort().forEach(name => {
        errorMessage += `Submodule ${colors.red(name)} is conflicted.\n`;
    });

    const result = {
        submoduleCommits: picks.commits,
        errorMessage: errorMessage === "" ? null : errorMessage,
        newMetaCommit: null,
    };
    yield metaIndex.write();
    if ("" === errorMessage) {
        if (0 === Object.keys(changes.simpleChanges).length &&
            0 === Object.keys(picks.commits).length) {
            yield SequencerStateUtil.cleanSequencerState(metaRepo.path());
            throw new UserError("Nothing to commit.");
        }
        result.newMetaCommit = yield finish(metaRepo, commit);
    }
    return result;
});

/**
 * Continue the in-progress cherry-pick in the specified `repo`.  Throw a
 * `UserError` if the continue cannot be initiated, e.g., because there is not
 * a cherry-pick in progress or there are still conflicts.  Return an object
 * describing the commits that were made and any errors that were generated.
 *
 * @async
 * @param {NodeGit.Repository} repo
 * @return {Object}      return
 * @return {String|null} return.newMetaCommit
 * @return {Object}      returm.submoduleCommits
 * @return {Object}      returm.newSubmoduleCommits
 * @return {String|null} return.errorMessage
 */
exports.continue = co.wrap(function *(repo) {
    assert.instanceOf(repo, NodeGit.Repository);

    const status = yield StatusUtil.getRepoStatus(repo);
    const seq = status.sequencerState;
    ensureCherryInProgress(seq);
    if (status.isConflicted()) {
        throw new UserError("Resolve conflicts then continue cherry-pick.");
    }
    const index = yield repo.index();
    const commit = yield repo.getCommit(seq.target.sha);
    const subResult = yield RebaseUtil.continueSubmodules(repo,
                                                          index,
                                                          status,
                                                          commit);
    yield index.write();
    const result = {
        newMetaCommit: null,
        submoduleCommits: subResult.commits,
        newSubmoduleCommits: subResult.newCommits,
        errorMessage: subResult.errorMessage,
    };
    yield index.write();
    if (null === subResult.errorMessage) {
        if (status.isIndexDeepClean() &&
            0 === Object.keys(subResult.commits).length &&
            0 === Object.keys(subResult.newCommits).length) {
            yield SequencerStateUtil.cleanSequencerState(repo.path());
            throw new UserError("Nothing to commit.");
        }

        result.newMetaCommit = yield finish(repo, commit);
    }
    return result;
});

/**
 * Abort the cherry-pick in progress in the specified `repo` and return the
 * repository to exactly the state of the initial commit.  Throw a `UserError`
 * if no cherry-pick is in progress.
 *
 * @param {NodeGit.Repository} repo
 */
exports.abort = co.wrap(function *(repo) {
    assert.instanceOf(repo, NodeGit.Repository);

    const seq = yield SequencerStateUtil.readSequencerState(repo.path());
    ensureCherryInProgress(seq);
    const commit = yield repo.getCommit(seq.originalHead.sha);
    yield Reset.reset(repo, commit, Reset.TYPE.MERGE);
    yield SequencerStateUtil.cleanSequencerState(repo.path());
    console.log("Cherry-pick aborted.");
});
