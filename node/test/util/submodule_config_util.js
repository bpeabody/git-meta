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
const fs      = require("fs-promise");
const NodeGit = require("nodegit");
const path    = require("path");

const Close               = require("../../lib/util/close");
const SubmoduleConfigUtil = require("../../lib/util/submodule_config_util");
const TestUtil            = require("../../lib/util/test_util");

describe("SubmoduleConfigUtil", function () {

    describe("resolveUrl", function () {
        const cases = {
            "inside": {
                base: "foo/bar",
                rel: "./b",
                expected: "foo/bar/b",
            },
            "next to": {
                base: "foo/bar",
                rel: "../baz",
                expected: "foo/baz",
            },
            "above": {
                base: "foo/bar",
                rel: "../../baz",
                expected: "baz",
            },
            "with prefix /": {
                base: "/foo/bar",
                rel: "../x",
                expected: "/foo/x",
            },
            "inside web url": {
                base: "http://a/b/c/d",
                rel: "./qz",
                expected: "http://a/b/c/d/qz",
            },
            "next to web url": {
                base: "http://a/b/c/d",
                rel: "../../../qal",
                expected: "http://a/qal",
            },
        };
        Object.keys(cases).forEach(function (caseName) {
            it(caseName, function () {
                const c = cases[caseName];
                const result = SubmoduleConfigUtil.resolveUrl(c.base, c.rel);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("resolveSubmoduleUrl", function () {
        const cases = {
            "not relative": {
                base: "/foo/bar",
                sub: "/x/y",
                expected: "/x/y",
            },
            "inside": {
                base: "/foo/bar",
                sub: "./y",
                expected: "/foo/bar/y",
            },
            "next to": {
                base: "/foo/bar",
                sub: "../y",
                expected: "/foo/y",
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                const result = SubmoduleConfigUtil.resolveSubmoduleUrl(c.base,
                                                                       c.sub);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("parseSubmoduleConfig", function () {
        const cases = {
            "trivial": {
                input: "",
                expected: {},
            },
            "one": {
                input: `\
[submodule "x/y"]
    path = x/y
[submodule "x/y"]
    url = /foo/bar/baz
`,
                expected: {
                    "x/y": "/foo/bar/baz",
                }
            },
            "all in one": {
                input: `\
[submodule "x/y"]
    path = x/y
    url = /foo/bar/baz
`,
                expected: {
                    "x/y": "/foo/bar/baz",
                }
            },
            "two": {
                input: `\
[submodule "x/y"]
    path = x/y
[submodule "x/y"]
    url = /foo/bar/baz
[submodule "a"]
    path = foo
[submodule "a"]
    url = wham-bam
`,
                expected: {
                    "x/y": "/foo/bar/baz",
                    a: "wham-bam",
                }
            },
            "two togethers": {
                input: `\
[submodule "x/y"]
    path = x/y
    url = /foo/bar/baz
[submodule "a"]
    path = foo
    url = wham-bam
`,
                expected: {
                    "x/y": "/foo/bar/baz",
                    a: "wham-bam",
                }
            },
            "with tabs": {
                input: `\
[submodule "x/y"]
\tpath = x/y
\turl = /foo/bar/baz
[submodule "a"]
\tpath = foo
\turl = wham-bam
`,
                expected: {
                    "x/y": "/foo/bar/baz",
                    a: "wham-bam",
                }
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result =
                             SubmoduleConfigUtil.parseSubmoduleConfig(c.input);
                assert.deepEqual(result, c.expected);
            });
        });
    });

    describe("parseSubmoduleConfig", function () {
        const cases = {
            "trivial": {
                input: "",
                expected: [],
            },
            "no subs": {
                input: `\
[core]
        repositoryformatversion = 0
        filemode = true
        bare = false
        logallrefupdates = true
        ignorecase = true
        precomposeunicode = true
`,
                expected: []
            },
            "one sub": {
                input: `\
[core]
        repositoryformatversion = 0
        filemode = true
        bare = false
        logallrefupdates = true
        ignorecase = true
        precomposeunicode = true
[submodule "x/y"]
        url = /Users/someone/trash/tt/foo
`,
                expected: ["x/y"],
            },
            "two": {
                input: `\
[core]
        repositoryformatversion = 0
        filemode = true
        bare = false
        logallrefupdates = true
        ignorecase = true
        precomposeunicode = true
[submodule "x/y"]
        url = /Users/someone/trash/tt/foo
[submodule "foo"]
        url = /Users/someone/trash/tt/foo
`,
                expected: ["x/y", "foo"],
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result =
                             SubmoduleConfigUtil.parseOpenSubmodules(c.input);
                assert.deepEqual(result.sort(), c.expected.sort());
            });
        });
    });

    describe("getSubmodulesFromCommit", function () {
        // We know that the actual parsing is done by `parseSubmoduleConfig`;
        // we just need to check that the parsing happens and that it works in
        // the case where there is no `.gitmodules` file.

        it("no gitmodules", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const headCommit = yield repo.getHeadCommit();
            const result = yield SubmoduleConfigUtil.getSubmodulesFromCommit(
                                                                   repo,
                                                                   headCommit);
            assert.deepEqual(result, {});
        }));

        it("with gitmodules", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const modulesPath = path.join(repo.workdir(),
                                          SubmoduleConfigUtil.modulesFileName);

            yield fs.writeFile(modulesPath, `\
[submodule "x/y"]
    path = x/y
[submodule "x/y"]
    url = /foo/bar/baz
`
                              );
            const withCommit = yield TestUtil.makeCommit(
                                        repo,
                                        [SubmoduleConfigUtil.modulesFileName]);

            const result = yield SubmoduleConfigUtil.getSubmodulesFromCommit(
                                                                   repo,
                                                                   withCommit);
            assert.deepEqual(result, {
                "x/y": "/foo/bar/baz",
            });
        }));
    });

    describe("getSubmodulesFromIndex", function () {
        // We know that the actual parsing is done by `parseSubmoduleConfig`;
        // we just need to check that the parsing happens and that it works in
        // the case where there is no `.gitmodules` file.

        it("no gitmodules", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const index = yield repo.index();
            const result = yield SubmoduleConfigUtil.getSubmodulesFromIndex(
                                                                        repo,
                                                                        index);
            assert.deepEqual(result, {});
        }));

        it("with gitmodules", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const modulesPath = path.join(repo.workdir(),
                                          SubmoduleConfigUtil.modulesFileName);

            yield fs.writeFile(modulesPath, `\
[submodule "x/y"]
    path = x/y
[submodule "x/y"]
    url = /foo/bar/baz
`
                              );
            const index = yield repo.index();
            yield index.addByPath(SubmoduleConfigUtil.modulesFileName);

            const result = yield SubmoduleConfigUtil.getSubmodulesFromIndex(
                                                                        repo,
                                                                        index);
            assert.deepEqual(result, {
                "x/y": "/foo/bar/baz",
            });
        }));
    });

    describe("getConfigPath", function () {
        it("breathing", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const result = SubmoduleConfigUtil.getConfigPath(repo);
            const expectedPath = path.join(repo.path(), "config");
            assert(TestUtil.isSameRealPath(result, expectedPath));
        }));
    });

    describe("getConfigLines", function () {
        it("breathing", function () {
            const result = SubmoduleConfigUtil.getConfigLines("foo", "bar");
            const expected = `\
[submodule "foo"]
\turl = bar
`;
            assert.equal(result, expected);
        });
    });

    describe("initSubmodule", function () {
        it("breathing", co.wrap(function *() {
            const repoPath = yield TestUtil.makeTempDir();
            yield fs.mkdir(path.join(repoPath, ".git"));
            const configPath = path.join(repoPath, ".git",  "config");
            yield fs.writeFile(configPath, "foo\n");
            yield SubmoduleConfigUtil.initSubmodule(repoPath, "xxx", "yyy");
            const data = yield fs.readFile(configPath, {
                encoding: "utf8"
            });
            const expected =`\
foo
[submodule "xxx"]
\turl = yyy
`;
            assert.equal(data, expected);
        }));
    });

    describe("initSubmoduleAndRepo", function () {

        const runTest = co.wrap(function *(repo,
                                           subRootRepo,
                                           url,
                                           subName,
                                           originUrl) {
            if (undefined === originUrl) {
                originUrl = "";
            }
            const subHead = yield subRootRepo.getHeadCommit();
            const submodule   = yield NodeGit.Submodule.addSetup(repo,
                                                                 url,
                                                                 subName,
                                                                 1);
            const subRepo = yield submodule.open();
            yield subRepo.fetchAll();
            subRepo.setHeadDetached(subHead.id());
            const newHead = yield subRepo.getCommit(subHead.id().tostrS());
            yield NodeGit.Reset.reset(subRepo,
                                      newHead,
                                      NodeGit.Reset.TYPE.HARD);
            yield submodule.addFinalize();
            const sig = repo.defaultSignature();
            yield repo.createCommitOnHead([".gitmodules", subName],
                                          sig,
                                          sig,
                                          "my message");
            yield Close.close(repo, subName);
            const repoPath = repo.workdir();
            const result = yield SubmoduleConfigUtil.initSubmoduleAndRepo(
                                                                     originUrl,
                                                                     repoPath,
                                                                     subName,
                                                                     url);
            assert.instanceOf(result, NodeGit.Repository);
            assert(TestUtil.isSameRealPath(result.workdir(),
                                           path.join(repoPath, subName)));

            // Now verify, but re-open repo as the changes we made may not be
            // in the cache for the existing repo.

            const newRepo = yield NodeGit.Repository.open(repoPath);
            const newSub = yield NodeGit.Submodule.lookup(newRepo, subName);
            const newSubRepo = yield newSub.open();

            // Change into the sub repo path to cath incorrect handling of
            // relative paths.

            process.chdir(path.join(repoPath, subName));
            yield newSubRepo.fetchAll();
            const remoteBranch = yield newSubRepo.getBranch("origin/master");
            const id = remoteBranch.target();
            assert.equal(id.tostrS(), subHead.id().tostrS());
        });

        it("simple", co.wrap(function *() {
            const repo        = yield TestUtil.createSimpleRepository();
            const subRootRepo = yield TestUtil.createSimpleRepository();
            yield runTest(repo, subRootRepo, subRootRepo.workdir(), "foo");
        }));

        it("deep name", co.wrap(function *() {
            const repo        = yield TestUtil.createSimpleRepository();
            const subRootRepo = yield TestUtil.createSimpleRepository();
            yield runTest(repo, subRootRepo, subRootRepo.workdir(), "x/y/z");
        }));

        it("relative origin", co.wrap(function *() {
            // Make sure we normalize relative paths.  If we leave a relative
            // path in the origin, we can't fetch.

            const tempDir = yield TestUtil.makeTempDir();
            const metaDir = path.join(tempDir, "meta");
            const repo = yield TestUtil.createSimpleRepository(metaDir);
            const subRootRepo = yield TestUtil.createSimpleRepository(
                                                   path.join(tempDir, "root"));
            // Have to start out in the meta directory or it won't even be able
            // to configure the submodule with a relative path -- it will fail
            // too early.

            process.chdir(metaDir);
            yield runTest(repo,
                          subRootRepo,
                          "../root",
                          "a/b",
                          metaDir);
        }));
    });
});

