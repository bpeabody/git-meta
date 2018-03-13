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

const TYPE = {
    CHERRY_PICK: "CHERRY_PICK",
    MERGE: "MERGE",
    REBASE: "REBASE",
};

/**
 * This module defines the `SequencerState` value-semantic type.
 */

/**
 * @class CommitAndBranch
 *
 * This class describes a commit and optionally the branch it came from.
 */
class CommitAndBranch {
    /**
     * Create a new `CommitAndBranch` object.
     *
     * @param {String}      sha
     * @param {String|null} branch
     */
    constructor(sha, branch) {
        assert.isString(sha);
        if (null !== branch) {
            assert.isString(branch);
        }
        this.d_sha = sha;
        this.d_branch = branch;

        Object.freeze(this);
    }

    /**
     * @property {String} sha  the unique identifier for this commit
     */
    get sha() {
        return this.d_sha;
    }

    /**
     * @property {String|null} branch
     *
     * If the commit was referenced by a branch, this is its name.
     */
    get branch() {
        return this.d_branch;
    }
}

/**
 * @class SequencerState
 *
 * This class represents the state of an in-progress sequence operation such as
 * a merge, cherry-pick, or rebase.
 */
class SequencerState {
    /**
     * Create a new `SequencerState` object.  The behavior is undefined unless
     * `0 <= currentLength` and `commits.length > currentCommit`.
     */
    constructor(type, originalHead, target, commits, currentCommit) {
        assert.isString(type);
        assert.property(TYPE, type);
        assert.instanceOf(originalHead, CommitAndBranch);
        assert.instanceOf(target, CommitAndBranch);
        assert.isArray(commits);
        assert.isNumber(currentCommit);
        assert(0 <= currentCommit);
        assert(commits.length > currentCommit);

        this.d_type = type;
        this.d_originalHead = originalHead;
        this.d_target = target;
        this.d_commits = commits;
        this.d_currentCommit = currentCommit;

        Object.freeze(this);
    }

    /**
     * @property {TYPE}  the type of operation in progress
     */
    get type() {
        return this.d_type;
    }

    /**
     * @property {CommitAndBranch} originalHead
     * what HEAD pointed to when the operation started
     */
    get originalHead() {
        return this.d_originalHead;
    }

    /**
     * @property {CommitAndBranch} target
     * the commit that was the target of the operation
     */
    get target() {
        return this.d_target;
    }

    /**
     * @property {[String]} commits  the sequence of commits to operate on
     */
    get commits() {
        return this.d_commits;
    }

    /**
     * @property {Number} currentCommit  index of the current commit
     */
    get currentCommit() {
        return this.d_currentCommit;
    }
}

SequencerState.TYPE = TYPE;
SequencerState.CommitAndBranch = CommitAndBranch;

module.exports = SequencerState;
