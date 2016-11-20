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

const assert  = require("chai").assert;
const co      = require("co");
const NodeGit = require("nodegit");

const Open            = require("../../lib/util/open");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");

describe("openOnCommit", function () {
    // Assumption is that 'x' is the target repo.

    const cases = {
        "simple": {
            initial: "a=B|x=U",
            subName: "s",
            url: "a",
            commitSha: "1",
            expected: "x=E:Os",
        },
        "not head": {
            initial: "a=B:C3-1;Bmaster=3|x=U",
            subName: "s",
            url: "a",
            commitSha: "3",
            expected: "x=E:Os H=3",
        },
    };
    Object.keys(cases).forEach(caseName => {
        const c = cases[caseName];
        it(caseName, co.wrap(function *() {
            const manipulator = co.wrap(function *(repos, maps) {
                assert.property(maps.reverseMap, c.commitSha);
                assert.property(maps.reverseUrlMap, c.url);
                const commit = maps.reverseMap[c.commitSha];
                const url = maps.reverseUrlMap[c.url];
                const x = repos.x;
                const result = yield Open.openOnCommit("",
                                                       x.workdir(),
                                                       c.subName,
                                                       url,
                                                       commit);
                assert.instanceOf(result, NodeGit.Repository);
            });
            yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                           c.expected,
                                                           manipulator);
        }));
    });
});
