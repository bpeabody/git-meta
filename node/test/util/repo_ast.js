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

const RepoAST = require("../../lib/util/repo_ast");

describe("RepoAST", function () {

    describe("Branch", function () {
        it("breath", function () {
            const b = new RepoAST.Branch("name", "upstream");
            assert.isFrozen(b);
            assert.equal(b.sha, "name");
            assert.equal(b.tracking, "upstream");
        });
        it("null tracking", function () {
            const b = new RepoAST.Branch("name", null);
            assert.isNull(b.tracking);
        });
    });

    describe("Submodule", function () {
        it("breath", function () {
            const s = new RepoAST.Submodule("foo", "bar");
            assert.instanceOf(s, RepoAST.Submodule);
            assert.isFrozen(s);
            assert.equal(s.url, "foo");
            assert.equal(s.sha, "bar");
        });
        it("null sha", function () {
            const s = new RepoAST.Submodule("foo", null);
            assert.isNull(s.sha);
        });
    });

    describe("Commit", function () {

        // Basically just testing that the constructor and accessors perform.

        const cases = {
            "trivial": {
                input: undefined,
                eparents: [],
                echanges: {},
                emessage: "",
            },
            "simple": {
                input: {
                    parents: ["foo"],
                    changes: { a: "b" },
                    message: "bam",
                },
                eparents: ["foo"],
                echanges: { a: "b"},
                emessage: "bam",
            },
            "delete change": {
                input: {
                    changes: { b: null },
                },
                eparents: [],
                echanges: { b: null, },
                emessage: "",
            },
            "add a submodule": {
                input: {
                    changes: { b: new RepoAST.Submodule("x", "y") },
                },
                eparents: [],
                echanges: { b: new RepoAST.Submodule("x", "y"), },
                emessage: "",
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                const obj = new RepoAST.Commit(c.input);
                assert.isFrozen(obj);

                // Check that result is expected, and not same as input object.

                assert.deepEqual(obj.parents, c.eparents);
                assert.deepEqual(obj.changes, c.echanges);
                assert.equal(obj.message, c.emessage);

                if (c.input) {
                    assert.notEqual(obj.parents, c.input.parent);
                    assert.notEqual(obj.changes, c.input.change);
                }
            });
        });
    });
    describe("Remote", function () {

        // Basically just testing that the constructor and accessors perform.

        const cases = {
            "trivial": {
                iurl: "x",
                args: undefined,
                eurl: "x",
                ebranches: {},
            },
            "branches": {
                iurl: "y",
                args: { branches: { x: "y", q: "r" } },
                eurl: "y",
                ebranches: { x: "y", q: "r" },
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                const obj = new RepoAST.Remote(c.iurl, c.args);
                assert.isFrozen(obj);

                // Check that result is expected, and not same as input object.

                assert.equal(obj.url, c.eurl);
                assert.deepEqual(obj.branches, c.ebranches);
                assert.deepEqual(obj.changes, c.echanges);

                if (c.args && c.args.branches) {
                    assert.notEqual(obj.branches, c.args.branches);
                }
            });
        });
    });

    describe("AST", function () {

        describe("constructor", function () {
            // Basically just testing that the constructor and accessors
            // perform.

            const Commit = RepoAST.Commit;
            const Rebase = RepoAST.Rebase;
            const Remote = RepoAST.Remote;

            const c1       = new Commit();
            const cWithPar = new Commit({ parents: ["1"] });
            const cWithSubmodule = new Commit({
                changes: { x: new RepoAST.Submodule("foo", "bar") }
            });

            function m(input,
                       expected,
                       fails) {
                expected = expected || {};
                return {
                    input   : input,
                    ebare   : ("bare" in expected) ? expected.bare : false,
                    ecommits: ("commits" in expected) ? expected.commits: {},
                    ebranches:
                        ("branches" in expected) ? expected.branches : {},
                    erefs:
                        ("refs" in expected) ? expected.refs : {},
                    ehead   : ("head" in expected) ? expected.head : null,
                    ebranch : ("branch" in expected) ? expected.branch : null,
                    eremotes: ("remotes" in expected) ? expected.remotes : {},
                    eindex  : ("index" in expected) ? expected.index : {},
                    eworkdir: ("workdir" in expected) ? expected.workdir : {},
                    eopenSubmodules: ("openSubmodules" in expected) ?
                                                  expected.openSubmodules : {},
                    erebase: ("rebase" in expected) ?
                        expected.rebase : null,
                    econflictedFiles: ("conflictedFiles" in expected) ?
                        expected.conflictedFiles : [],
                    fails   : fails,
                };
            }

            const cases = {
                "trivial": m(undefined, undefined, false),
                "simple" : m(
                    {
                        commits: {},
                        branches: {},
                        head: null,
                        currentBranchName: null,
                        rebase: null,
                        conflictedFiles: [],
                        bare: false,
                    },
                    undefined,
                    false),
                "with bare": m({ bare: true }, { bare: true} , false),
                "bad bare with index": m({
                    bare: true,
                    index: { foo: "bar" },
                    commits: {"1": c1 },
                    head: "1",
                }, undefined, true),
                "bad bare with workdir": m({
                    bare: true,
                    workdir: { foo: "bar" },
                    commits: {"1": c1 },
                    head: "1",
                }, undefined, true),
                "bad bare with rebase": m({
                    bare: true,
                    rebase: new Rebase("foo", "1", "1"),
                    commits: {"1": c1 },
                    head: "1",
                }, undefined, true),
                "conflicted files": m({
                    bare: true,
                    conflictedFiles: ["foo/bar"],
                    commits: { "1": c1 },
                    head: "1",
                }, undefined, true),
                "branchCommit": m({
                    commits: {"1":c1, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    head: "1",
                    currentBranchName: null,
                }, {
                    commits: {"1":c1, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    head: "1",
                }, false),
                "refCommit": m({
                    commits: {"1":c1, "2": cWithPar},
                    refs: {"foo/bar": "2"},
                    currentBranchName: null,
                }, {
                    commits: {"1":c1, "2": cWithPar},
                    refs: {"foo/bar": "2"},
                }, false),
                "refIsBranch": m({
                    commits: {"1":c1, "2": cWithPar},
                    refs: {"heads/bar": "2"},
                    currentBranchName: null,
                }, {
                }, true),
                "refIsRemote": m({
                    commits: {"1":c1, "2": cWithPar},
                    refs: {"remotes/bar": "2"},
                    currentBranchName: null,
                }, {
                }, true),
                "with submodule": m({
                    commits: {"1":cWithSubmodule, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    head: "1",
                    currentBranchName: null,
                }, {
                    commits: {"1":cWithSubmodule, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    head: "1",
                }, false),
                "remotes": m({
                    remotes: {
                        foo: new Remote("my-url"),
                    }
                }, {
                    remotes: { foo: new Remote("my-url") },
                }, false),
                "badParent": m({ commits: { "2": cWithPar }},
                               undefined,
                               true),
                "badBranch": m({
                    branches: { "master": new RepoAST.Branch("3", null) },
                }, undefined, true),
                "badRef": m({ refs: { "a/b": "3"}}, undefined, true),
                "badHead": m({ head: "3"}, undefined, true),
                "branch": m({
                    commits: {"1": c1},
                    branches: {"master": new RepoAST.Branch("1", null) },
                    head: "1",
                    currentBranchName: "master",
                }, {
                    commits: {"1": c1},
                    branches: {"master": new RepoAST.Branch("1", null) },
                    head: "1",
                    branch: "master",
                }, false),
                "ref": m({
                    commits: {"1": c1},
                    refs: {"a/b": "1"},
                }, {
                    commits: {"1": c1},
                    refs: {"a/b": "1"},
                }, false),
                "currentBranchIsRef": m({
                    commits: {"1": c1},
                    refs: {"a/b": "1"},
                    head: "1",
                    currentBranchName: "a/b",
                }, {
                }, true),
                "badBranch with good commit": m({
                    commits: {"1": c1},
                    branches: {"aster": new RepoAST.Branch("1", null) },
                    head: null,
                    currentBranchName: "master",
                }, undefined, true),
                "unreachable": m({ commits: {"1": c1} }, undefined, true),
                "reachedByHead": m({
                    commits: {"1": c1},
                    head: "1",
                }, {
                    commits: {"1": c1},
                    head: "1",
                }, false),
                "reachedByRemote": m({
                    commits: {"1": c1},
                    remotes: {
                        bar: new Remote("foo", { branches: { "bar": "1"}, }),
                    },
                }, {
                    commits: {"1": c1},
                    remotes: {
                        bar: new Remote("foo", { branches: { "bar": "1"}, }),
                    },
                }, false),
                "bare with current branch": m({
                    commits: {"1":c1, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    head: null,
                    currentBranchName: "master",
                }, {
                    commits: {"1":c1, "2": cWithPar},
                    branches: {"master": new RepoAST.Branch("2", null) },
                    branch: "master",
                    head: null,
                }, false),
                "index": m({
                    commits: { "1": c1},
                    head: "1",
                    index: { foo: "bar"},
                }, {
                    commits: { "1": c1},
                    head: "1",
                    index: { foo: "bar"},
                }, false),
                "index without head": m({
                    commits: { "1": c1},
                    head: null,
                    index: { foo: "bar"},
                }, {
                    commits: { "1": c1},
                    head: "1",
                    index: { foo: "bar"},
                }, true),
                "index with submodule": m({
                    commits: { "1": c1},
                    head: "1",
                    index: { foo: new RepoAST.Submodule("z", "a") },
                }, {
                    commits: { "1": c1},
                    head: "1",
                    index: { foo: new RepoAST.Submodule("z", "a") },
                }, false),
                "workdir": m({
                    commits: { "1": c1},
                    head: "1",
                    workdir: { foo: "bar"},
                }, {
                    commits: { "1": c1},
                    head: "1",
                    workdir: { foo: "bar"},
                }, false),
                "workdir without head": m({
                    commits: { "1": c1},
                    head: null,
                    workdir: { foo: "bar"},
                }, {
                    commits: { "1": c1},
                    head: "1",
                    workdir: { foo: "bar"},
                }, true),
                "openSubmodules": m({
                    commits: { "1": cWithSubmodule },
                    head: "1",
                    openSubmodules: { x: new RepoAST() },
                }, {
                    commits: { "1": cWithSubmodule },
                    head: "1",
                    openSubmodules: { x: new RepoAST() },
                }, false),
                "bad path openSubmodules": m({
                    commits: { "1": cWithSubmodule },
                    head: "1",
                    openSubmodules: { y: new RepoAST() },
                }, {
                }, true),
                "bad commit change": m({
                    commits: {
                        "1": new Commit({ changes: { x: "y"}}),
                        "2": new Commit({
                            parents: ["1"],
                            changes: { x: "y"},
                        }),
                    },
                    head: "2",
                }, {}, true),
                "bad commit change from ancestor": m({
                    commits: {
                        "1": new Commit({ changes: { x: "y"}}),
                        "2": new Commit({
                            parents: ["1"],
                            changes: { y: "y"},
                        }),
                        "3": new Commit({
                            parents: ["2"],
                            changes: { x: "y"},
                        }),
                    },
                    head: "2",
                }, {}, true),
                "ok commit duplicting right-hand ancestory": m({
                    commits: {
                        "1": new Commit({ changes: { x: "y"}}),
                        "2": new Commit({ changes: { y: "y"}, }),
                        "3": new Commit({
                            parents: ["1","2"],
                            changes: { y: "y"},
                        }),
                    },
                    head: "3",
                }, {
                    commits: {
                        "1": new Commit({ changes: { x: "y"}}),
                        "2": new Commit({ changes: { y: "y"}, }),
                        "3": new Commit({
                            parents: ["1","2"],
                            changes: { y: "y"},
                        }),
                    },
                    head: "3",
                }, false),
                "bad commit deletion": m({
                    commits: {
                        "1": new Commit({ changes: { x: null } }),
                    },
                    head: "1",
                }, {}, true),
                "with rebase": m({
                    commits: {
                        "1": new Commit(),
                    },
                    head: "1",
                    rebase: new Rebase("fff", "1", "1"),
                }, {
                    commits: {
                        "1": new Commit(),
                    },
                    head: "1",
                    rebase: new Rebase("fff", "1", "1"),
                }),
                "with rebase specific commits": m({
                    commits: {
                        "1": new Commit(),
                        "2": new Commit(),
                    },
                    head: "1",
                    rebase: new Rebase("fff", "2", "2"),
                }, {
                    commits: {
                        "1": new Commit(),
                        "2": new Commit(),
                    },
                    head: "1",
                    rebase: new Rebase("fff", "2", "2"),
                }),
                "bad rebase": m({
                    rebase: new Rebase("fff", "1", "1"),
                }, undefined, true),
            };
            Object.keys(cases).forEach(caseName => {
                it(caseName, function () {
                    const c = cases[caseName];
                    if (c.fails) {
                        // `fails` indicates that it throws due to out of
                        // contract.  We don't document what type of error is
                        // thrown on contract violation.

                        assert.throws(() => new RepoAST(c.input), "");
                        return;                                       // RETURN
                    }
                    const obj = new RepoAST(c.input);
                    assert.deepEqual(obj.commits, c.ecommits);
                    assert.deepEqual(obj.branches, c.ebranches);
                    assert.deepEqual(obj.refs, c.erefs);
                    assert.equal(obj.head, c.ehead);
                    assert.equal(obj.currentBranchName, c.ebranch);
                    assert.deepEqual(obj.index, c.eindex);
                    assert.deepEqual(obj.workdir, c.eworkdir);
                    assert.deepEqual(obj.openSubmodules, c.eopenSubmodules);
                    assert.deepEqual(obj.rebase, c.erebase);
                    assert.deepEqual(obj.conflictedFiles, c.econflictedFiles);
                    assert.equal(obj.bare, c.ebare);

                    if (c.input) {
                        assert.notEqual(obj.commits, c.input.commits);
                        assert.notEqual(obj.branches, c.input.branches);
                        assert.notEqual(obj.refs, c.input.refs);
                        assert.notEqual(obj.remotes, c.input.remotes);
                        assert.notEqual(obj.workdir, c.input.workdir);
                        assert.notEqual(obj.openSubmodules,
                                        c.input.openSubmodules);
                    }
                });
            });
        });

        describe("accumulateDirChanges", function () {
            const cases = {
                "trivial": {
                    dest: {},
                    changes: {},
                    expected: {}
                },
                "add": {
                    dest: {},
                    changes: { foo: "bar" },
                    expected: { foo: "bar" },
                },
                "overwrite": {
                    dest: { foo: "bar", baz: "bam" },
                    changes: { a: "b", foo: "3" },
                    expected: { foo: "3", baz: "bam", a: "b" },
                },
                "delete": {
                    dest: { foo: "bar", baz: "bam" },
                    changes: { foo: null },
                    expected: { baz: "bam" },
                },
            };
            Object.keys(cases).forEach(caseName => {
                const c = cases[caseName];
                it(caseName, function () {
                    RepoAST.accumulateDirChanges(c.dest, c.changes);
                    assert.deepEqual(c.dest, c.expected);
                });
            });
        });

        describe("renderCommit", function () {
            const Commit = RepoAST.Commit;
            const c1 = new Commit({ changes: { foo: "bar" }});
            const c2 = new Commit({ changes: { foo: "baz" }});
            const mergeChild = new Commit({
                parents: ["3"],
                changes: { bam: "blast" },
            });
            const merge = new Commit({
                parents: ["1", "2"],
                changes: {}
            });
            const deleter = new Commit({
                parents: ["1"],
                changes: { foo: null }
            });
            const submodule = new RepoAST.Submodule("x", "y");
            const subCommit = new Commit({
                parents: ["1"],
                changes: { baz: submodule },
            });
            const cases = {
                "one": {
                    commits: { "1": c1},
                    from: "1",
                    expected: { foo: "bar" },
                    ecache: {
                        "1": { foo: "bar" },
                    },
                },
                "merge": {
                    commits: { "1": c1, "2": c2, "3": merge},
                    from: "3",
                    expected: { foo: "bar" },
                    ecache: {
                        "1": c1.changes,
                        "3": { foo: "bar" },
                    },
                },
                "merge child": {
                    commits: { "1": c1, "2": c2, "3": merge, "4": mergeChild},
                    from: "4",
                    expected: { foo: "bar", bam: "blast" },
                    ecache: {
                        "1": c1.changes,
                        "3": { foo: "bar" },
                        "4": { foo: "bar", bam: "blast" },
                    },
                },
                "deletion": {
                    commits: { "1": c1, "2": deleter },
                    from: "2",
                    expected: {},
                    ecache: {
                        "1": c1.changes,
                        "2": {}
                    },
                },
                "with sub": {
                    commits: { "1": c1, "2": subCommit },
                    from: "2",
                    expected: { foo: "bar", baz: submodule },
                    ecache: {
                        "1": c1.changes,
                        "2": { foo: "bar", baz: submodule },
                    },
                },
                "use the cache": {
                    commits: { "1": c1 },
                    from: "1",
                    cache: { "1": { foo: "baz" } },
                    expected: { foo: "baz" },
                    ecache: { "1": { foo: "baz"}, },
                },
            };
            Object.keys(cases).forEach(caseName => {
                const c = cases[caseName];
                it(caseName, function () {
                    let cache = c.cache || {};
                    const result =
                                RepoAST.renderCommit(cache, c.commits, c.from);
                    assert.deepEqual(result,
                                     c.expected,
                                     JSON.stringify(result));
                    assert.deepEqual(cache, c.ecache, JSON.stringify(cache));
                });
            });
        });

        describe("AST.copy", function () {
            const Rebase = RepoAST.Rebase;
            const base = new RepoAST({
                commits: { "1": new RepoAST.Commit()},
                branches: { "master": new RepoAST.Branch("1", null) },
                refs: { "a/b": "1"},
                head: "1",
                currentBranchName: "master",
                index: { foo: "bar" },
                workdir: { foo: "bar" },
                rebase: new Rebase("hello", "1", "1"),
                conflictedFiles: [ "foo" ],
                bare: false,
            });
            const newArgs = {
                commits: { "2": new RepoAST.Commit()},
                branches: { "foo": new RepoAST.Branch("2", null) },
                refs: { "foo/bar": "2" },
                head: "2",
                currentBranchName: "foo",
                remotes: { "foo": new RepoAST.Remote("meeeee") },
                index: { foo: "bar" },
                workdir: { foo: "bar" },
                rebase: new Rebase("hello world", "2", "2"),
                conflictedFiles: [ "foo" ],
                bare: false,
            };
            const cases = {
                "trivial": {
                    i: undefined,
                    e: base,
                },
                "all": {
                    i: newArgs,
                    e: new RepoAST(newArgs),
                },
                "bare": {
                    i: {
                        bare: true,
                        index: {},
                        workdir: {},
                        rebase: null,
                        conflictedFiles: [],
                    },
                    e: new RepoAST({
                        commits: { "1": new RepoAST.Commit()},
                        branches: { "master": new RepoAST.Branch("1", null) },
                        refs: { "a/b": "1"},
                        head: "1",
                        currentBranchName: "master",
                        bare: true,
                    }),
                },
            };
            Object.keys(cases).forEach(caseName => {
                it(caseName, function () {
                    const c = cases[caseName];
                    const obj = base.copy(c.i);
                    assert.deepEqual(obj.commits, c.e.commits);
                    assert.deepEqual(obj.branches, c.e.branches);
                    assert.deepEqual(obj.refs, c.e.refs);
                    assert.deepEqual(obj.remotes, c.e.remotes);
                    assert.equal(obj.head, c.e.head);
                    assert.equal(obj.currentBranchName, c.e.currentBranchName);
                    assert.deepEqual(obj.index, c.e.index);
                    assert.deepEqual(obj.workdir, c.e.workdir);
                    assert.deepEqual(obj.openSubmodules, c.e.openSubmodules);
                    assert.deepEqual(obj.rebase, c.e.rebase);
                    assert.deepEqual(obj.conflictedFiles,
                                     c.e.conflictedFiles);
                    assert.equal(obj.bare, c.e.bare);
                });
            });
        });

        describe("renderIndex", function () {

            // This method is implemented in terms of `renderCommit` and
            // `accumulateChanges`.  We just need to make sure they're put
            // together properly.

            const Commit = RepoAST.Commit;
            const c1 = new Commit({ changes: { foo: "bar" }});
            const cases = {
                "no index": {
                    commits: { "1": c1},
                    from: "1",
                    expected: { foo: "bar" },
                },
                "with index": {
                    commits: { "1": c1},
                    from: "1",
                    index: { y: "z" },
                    expected: { foo: "bar", y: "z" },
                },
            };
            Object.keys(cases).forEach(caseName => {
                const c = cases[caseName];
                it(caseName, function () {
                    const index = c.index || {};
                    const result = RepoAST.renderIndex(c.commits,
                                                       c.from,
                                                       index);
                    assert.deepEqual(result,
                                     c.expected,
                                     JSON.stringify(result));
                });
            });
        });

    });
});
