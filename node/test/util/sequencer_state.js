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

const assert = require("chai").assert;

const SequencerState = require("../../lib/util/sequencer_state");

describe("SequencerState", function () {

const TYPE = SequencerState.TYPE;
const CommitAndRef = SequencerState.CommitAndRef;

    describe("CommitAndRef", function () {
        it("breath", function () {
            const withRef = new CommitAndRef("foo", "bar");
            assert.isFrozen(withRef);
            assert.equal(withRef.sha, "foo");
            assert.equal(withRef.ref, "bar");

            const noRef = new CommitAndRef("wee", null);
            assert.equal(noRef.sha, "wee");
            assert.isNull(noRef.ref);
        });
    });
    it("breath", function () {
        const original = new CommitAndRef("a", "foo");
        const target = new CommitAndRef("c", "bar");
        const seq = new SequencerState(TYPE.MERGE, original, target, ["3"], 0);
        assert.isFrozen(seq);
        assert.equal(seq.type, TYPE.MERGE);
        assert.deepEqual(seq.originalHead, original);
        assert.deepEqual(seq.target, target);
        assert.deepEqual(seq.commits, ["3"]);
        assert.equal(seq.currentCommit, 0);
    });
});
