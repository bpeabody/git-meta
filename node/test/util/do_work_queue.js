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

const assert = require("chai").assert;
const co     = require("co");

const DoWorkQueue = require("../../lib/util/do_work_queue");

function nextTick() {
    return new Promise(callback => {
        process.nextTick(callback);
    });
}

describe("DoWorkQueue", function () {
    // TODO: These guys need more rigorous test drivers.

    it("doInParallel", co.wrap(function *() {
        let work = [];
        let expected = [];
        const NUM_TO_DO = 323;
        for (let i = 0; i < NUM_TO_DO; ++i) {
            work.push(i);
            expected.push(i * 2);
        }
        function getWork(i, index) {
            assert.equal(i, index);
            return co(function *() {
                yield nextTick();
                return i * 2;
            });
        }
        const result = yield DoWorkQueue.doInParallel(work, getWork);
        assert.equal(result.length, NUM_TO_DO);
        assert.deepEqual(result, expected);
    }));

    it("doInBatches", co.wrap(function *() {
        let work = [];
        let expected = [];
        const NUM_TO_DO = 323;
        for (let i = 0; i < NUM_TO_DO; ++i) {
            work.push(i);
            expected.push(i * 2);
        }
        function getWork(values) {
            return co(function *() {
                yield nextTick();
                return values.map(x => x * 2);
            });
        }
        const result = yield DoWorkQueue.doInBatches(work, 10, getWork);
        assert.equal(result.length, NUM_TO_DO);
        assert.deepEqual(result, expected);
    }));
});
