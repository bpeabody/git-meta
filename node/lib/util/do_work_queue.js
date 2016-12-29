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

/**
 * Call the specified `getWork` function to create a promise to do work for
 * each element in the specified `queue`, limiting the amount of parallel work
 * in progress to an unspecified internal limit.  Return an array containing
 * the result of the work *in the order that it was received*, which may not be
 * the same as the order in which the work was completed.
 *
 * @async
 * @param {Array}                  queue
 * @param {(_, Number) => Promise} getWork
 */
exports.doInParallel = co.wrap(function *(queue, getWork) {
    assert.isArray(queue);
    assert.isFunction(getWork);


    const total = queue.length;
    const result = new Array(total);
    let next = 0;

    const doWork = co.wrap(function *() {
        while (next !== total) {
            const current = next++;
            const currentResult = yield getWork(queue[current], current);
            result[current] = currentResult;
        }
    });

    // Do the work.  Create an array of `MAX_WORK` items and yield on it.

    let work = [];

    // Somewhat-arbitrarily chosen limit on parallel work.  I pick this number
    // as it is probably high enough to get most possible benefit from
    // parallelism while being low enough to avoid hitting resources limits.

    const MAX_WORK = 100;
    for (let i = 0; i < MAX_WORK; ++i) {
        work.push(doWork());
    }
    yield work;
    return result;
});

/**
 * Divide the specified `queue` into the specified number of `batches`; use the
 * specified `getWork` function to get a promise to execute a batch of work; it
 * must return an array containing a result for each item in the batch.  Return
 * an array containing the complete set of results, such that each item in the
 * array is in the same order as the input `queue`.
 *
 * @async
 * @param {Array}                    queue
 * @param {Number}                   batches
 * @param {(Array, Number)  => Promise (Array)} getWork
 */
exports.doInBatches = co.wrap(function *(queue, batches, getWork) {
    assert.isArray(queue);
    assert.isNumber(batches);
    assert.isFunction(getWork);

    // Compute the size of batches to use so that we execute `batches` number
    // of batches if possible, or 1 otherwise.

    const queueCopy = queue.slice(0);
    const batchSize  = Math.ceil(queue.length / batches);
    const batchedQueue = [];
    while (0 !== queueCopy.length) {
        batchedQueue.push(queueCopy.splice(0, batchSize));
    }
    const batchedResults = yield batchedQueue.map(getWork);
    return batchedResults.reduce((acc, next) => acc.concat(next), []);
});
