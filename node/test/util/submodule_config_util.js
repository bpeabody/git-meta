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
const rimraf  = require("rimraf");

const SparseCheckoutUtil  = require("../../lib/util/sparse_checkout_util");
const SubmoduleConfigUtil = require("../../lib/util/submodule_config_util");
const TestUtil            = require("../../lib/util/test_util");
const UserError           = require("../../lib/util/user_error");

describe("SubmoduleConfigUtil", function () {

    describe("clearSubmoduleConfigEntry", function () {
        function configPath(repo) {
            return path.join(repo.path(), "config");
        }
        function getConfigContent(repo) {
            return fs.readFileSync(configPath(repo), "utf8");
        }
        it("noop", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const content = getConfigContent(repo);
            yield SubmoduleConfigUtil.clearSubmoduleConfigEntry(repo.path(),
                                                                "foo");
            const result = getConfigContent(repo);
            assert.equal(content, result);
        }));
        it("remove breathing", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const baseSubRepo = yield TestUtil.createSimpleRepository();
            const baseSubPath = baseSubRepo.workdir();
            const content = getConfigContent(repo);
            yield NodeGit.Submodule.addSetup(repo, baseSubPath, "x/y", 1);
            yield SubmoduleConfigUtil.clearSubmoduleConfigEntry(repo.path(),
                                                                "x/y");
            const result = getConfigContent(repo);
            assert.equal(content, result);
        }));
    });

    describe("deinit", function () {

        // Going to do a simple test here to verify that after closing a
        // submodule:
        //
        // - the submodule dir contains only the `.git` line file.
        // - the git repo is in a clean state

        it("breathing", co.wrap(function *() {

            // Create and set up repos.

            const repo = yield TestUtil.createSimpleRepository();
            const baseSubRepo = yield TestUtil.createSimpleRepository();
            const baseSubPath = baseSubRepo.workdir();
            const subHead = yield baseSubRepo.getHeadCommit();

            // Set up the submodule.

            const sub = yield NodeGit.Submodule.addSetup(repo,
                                                         baseSubPath,
                                                         "x/y",
                                                         1);
            const subRepo = yield sub.open();
            const origin = yield subRepo.getRemote("origin");
            yield origin.connect(NodeGit.Enums.DIRECTION.FETCH,
                                 new NodeGit.RemoteCallbacks(),
                                 function () {});
                                 yield subRepo.fetch("origin", {});
            subRepo.setHeadDetached(subHead.id().tostrS());
            yield sub.addFinalize();

            // Commit the submodule it.

            yield TestUtil.makeCommit(repo, ["x/y", ".gitmodules"]);

            // Verify that the status currently indicates a visible submodule.

            const addedStatus = yield NodeGit.Submodule.status(repo, "x/y", 0);
            const WD_UNINITIALIZED = (1 << 7);  // means "closed"
            assert(!(addedStatus & WD_UNINITIALIZED));

            // Then close it and recheck status.

            yield SubmoduleConfigUtil.deinit(repo, ["x/y"]);
            const closedStatus =
                                yield NodeGit.Submodule.status(repo, "x/y", 0);
            assert(closedStatus & WD_UNINITIALIZED);
        }));
        it("sparse mode", co.wrap(function *() {

            // Create and set up repos.

            const repo = yield TestUtil.createSimpleRepository();
            const baseSubRepo = yield TestUtil.createSimpleRepository();
            const baseSubPath = baseSubRepo.workdir();
            const subHead = yield baseSubRepo.getHeadCommit();

            // Set up the submodule.

            const sub = yield NodeGit.Submodule.addSetup(repo,
                                                         baseSubPath,
                                                         "x/y",
                                                         1);
            yield NodeGit.Submodule.addSetup(repo, baseSubPath, "x/z", 1);
            const subRepo = yield sub.open();
            const origin = yield subRepo.getRemote("origin");
            yield origin.connect(NodeGit.Enums.DIRECTION.FETCH,
                                 new NodeGit.RemoteCallbacks(),
                                 function () {});
                                 yield subRepo.fetch("origin", {});
            subRepo.setHeadDetached(subHead.id().tostrS());
            yield sub.addFinalize();

            // Commit the submodule it.

            yield TestUtil.makeCommit(repo, ["x/y", ".gitmodules"]);

            yield SparseCheckoutUtil.setSparseMode(repo);
            yield SubmoduleConfigUtil.deinit(repo, ["x/y"]);

            // Verify that directory for sub is gone

            let failed = false;
            try {
                yield fs.readdir(path.join(repo.workdir(), "x", "y"));
            } catch (e) {
                failed = true;
            }
            assert(failed);

            // verify we clean the root when all is gone

            failed = false;
            yield SubmoduleConfigUtil.deinit(repo, ["x/z"]);
            try {
                yield fs.readdir(path.join(repo.workdir(), "x"));
            } catch (e) {
                failed = true;
            }
            assert(failed);
        }));
    });

    describe("computeRelativeGitDir", function () {
        const cases = {
            "simple": {
                input: "foo",
                expected: "../.git/modules/foo",
            },
            "two": {
                input: "foo/bar",
                expected: "../../.git/modules/foo/bar",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result =
                            SubmoduleConfigUtil.computeRelativeGitDir(c.input);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("computeRelativeWorkDir", function () {
        const cases = {
            "simple": {
                input: "foo",
                expected: "../../../foo",
            },
            "two": {
                input: "foo/bar",
                expected: "../../../../foo/bar",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result =
                           SubmoduleConfigUtil.computeRelativeWorkDir(c.input);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("resolveUrl", function () {
        const cases = {
            "base": {
                base: "foo/bar",
                rel: "./b",
                expected: "foo/bar/b",
            },
            "dot": {
                base: "foo/bar",
                rel: ".",
                expected: "foo/bar",
            },
            "inside trailing /": {
                base: "foo/bar/",
                rel: "./b",
                expected: "foo/bar/b",
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
            "not relative, null origin": {
                base: null,
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
            "relative, but null origin": {
                base: null,
                sub: "../y",
                expected: "/foo/y",
                fails: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                let result;
                try {
                    result = SubmoduleConfigUtil.resolveSubmoduleUrl(c.base,
                                                                     c.sub);
                }
                catch (e) {
                    assert(c.fails);
                    assert.instanceOf(e, UserError);
                    return;
                }
                assert(!c.fails);
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
            "trailing slash": {
                input: `\
[submodule "x/y/"]
    path = x/y/
[submodule "x/y/"]
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

    describe("parseOpenSubmodules", function () {
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
            "one sub, duped": {
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

    describe("getSubmodulesFromWorkdir", function () {
        // We know that the actual parsing is done by `parseSubmoduleConfig`;
        // we just need to check that the parsing happens and that it works in
        // the case where there is no `.gitmodules` file.

        it("no gitmodules", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const result = SubmoduleConfigUtil.getSubmodulesFromWorkdir(repo);
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
            const result = SubmoduleConfigUtil.getSubmodulesFromWorkdir(repo);
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
            const configPath = path.join(repoPath, "config");
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
        it("already there", co.wrap(function *() {
            const repoPath = yield TestUtil.makeTempDir();
            const configPath = path.join(repoPath, "config");
            yield fs.writeFile(configPath, "foo\n");
            yield SubmoduleConfigUtil.initSubmodule(repoPath, "xxx", "zzz");
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

    describe("getTemplatePath", function () {
        it("no path", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const result = yield SubmoduleConfigUtil.getTemplatePath(repo);
            assert.isNull(result);
        }));
        it("a path", co.wrap(function *() {
            const repo = yield TestUtil.createSimpleRepository();
            const config = yield repo.config();
            yield config.setString("meta.submoduleTemplatePath", "foo");
            const result = yield SubmoduleConfigUtil.getTemplatePath(repo);
            assert.equal(result, "foo");
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
            yield SubmoduleConfigUtil.deinit(repo, [subName]);
            const repoPath = repo.workdir();
            const result = yield SubmoduleConfigUtil.initSubmoduleAndRepo(
                                                                     originUrl,
                                                                     repo,
                                                                     subName,
                                                                     url,
                                                                     null);
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

        it("reset URL", co.wrap(function *() {
            const repo        = yield TestUtil.createSimpleRepository();
            const subRootRepo = yield TestUtil.createSimpleRepository();
            const url = subRootRepo.workdir();
            yield runTest(repo, subRootRepo, url, "foo");
            const sub = yield NodeGit.Submodule.lookup(repo, "foo");
            const subRepo = yield sub.open();
            NodeGit.Remote.setUrl(subRepo, "origin", "/bar");
            yield SubmoduleConfigUtil.deinit(repo, ["foo"]);
            const newSub =
                yield SubmoduleConfigUtil.initSubmoduleAndRepo("",
                                                               repo,
                                                               "foo",
                                                               url,
                                                               null);
            const remote = yield newSub.getRemote("origin");
            const newUrl = remote.url();
            assert.equal(newUrl, url);
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

        it("with template", co.wrap(function *() {
            const templateDir = yield TestUtil.makeTempDir();
            const repo        = yield TestUtil.createSimpleRepository();
            const subDir = "bar";
            const subPath = path.join(templateDir, subDir);
            yield fs.mkdir(subPath);
            const fileName = "hello-sub-repo";
            const data = "welcome";
            yield fs.writeFile(path.join(subPath, fileName), data);
            const subRootRepo = yield TestUtil.createSimpleRepository();
            const subHead = yield subRootRepo.getHeadCommit();
            const url = subRootRepo.path();
            const submodule   = yield NodeGit.Submodule.addSetup(repo,
                                                                 url,
                                                                 "foo",
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
            yield repo.createCommitOnHead([".gitmodules", "foo"],
                                          sig,
                                          sig,
                                          "my message");
            yield SubmoduleConfigUtil.deinit(repo, ["foo"]);

            // Remove `foo` dir, otherwise, we will not need to re-init the
            // repo and the template will not be executed.

            yield (new Promise(callback => {
                return rimraf(path.join(subRepo.path()), {}, callback);
            }));

            yield SubmoduleConfigUtil.initSubmoduleAndRepo(url,
                                                           repo,
                                                           "foo",
                                                           url,
                                                           templateDir);

            const copiedPath = path.join(repo.path(),
                                         "modules",
                                         "foo",
                                         subDir,
                                         fileName);
            const read = yield fs.readFile(copiedPath, { encoding: "utf8" });
            assert.equal(read, data);
        }));
    });
    describe("writeConfigText", function () {
        const cases = {
            "base": {},
            "one": { a: "foo" },
            "two": { a: "foo", t: "/a/b/c"},
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = SubmoduleConfigUtil.writeConfigText(c);
                const parse = SubmoduleConfigUtil.parseSubmoduleConfig(result);
                assert.deepEqual(parse, c);
            });
        });
    });
    it("writeUrls", co.wrap(function *() {
        const repo = yield TestUtil.createSimpleRepository();
        const index = yield repo.index();
        yield SubmoduleConfigUtil.writeUrls(repo, index, {
            foo: "/bar"
        });
        const fromIndex =
                 yield SubmoduleConfigUtil.getSubmodulesFromIndex(repo, index);
        assert.deepEqual(fromIndex, {
            foo: "/bar"
        });
    }));
    describe("mergeUrls", function () {
        const cases = {
            "empty": {
                l: {},
                r: {},
                bases: [],
                expected: {},
            },
            "changed but same": {
                l: {},
                r: {},
                bases: [ {
                    foo: "bar",
                }],
                expected: {},
            },
            "changed but same, not deleted": {
                l: { foo: "baz" },
                r: { foo: "baz" },
                bases: [ {
                    foo: "bar",
                }],
                expected: {
                    foo: "baz",
                },
            },
            "changed on left but not right": {
                l: { foo: "baz" },
                r: { foo: "bar" },
                bases: [ {
                    foo: "bar",
                }],
                expected: {
                    foo: "baz",
                },
            },
            "changed on both": {
                l: { foo: "meh" },
                r: { foo: "moh" },
                bases: [{
                    foo: "bar",
                },
                ],
                expected: null,
            },
            "changed on both, but same in a base": {
                l: { foo: "meh" },
                r: { foo: "moh" },
                bases: [{
                    foo: "bar",
                }, {
                    foo: "meh",
                },
                ],
                expected: null,
            },
            "changed on right": {
                l: { foo: "bar" },
                r: { foo: "bam" },
                bases: [ {
                    foo: "bar",
                }],
                expected: {
                    foo: "bam",
                },
            },
            "removed on left, unchanged on right": {
                l: {},
                r: { foo: "bar" },
                bases: [ {
                    foo: "bar",
                }],
                expected: {},
            },
            "removed on left, changed on right": {
                l: {},
                r: { foo: "baz" },
                bases: [ {
                    foo: "bar",
                }],
                expected: null,
            },
            "added on left": {
                l: { foo: "bar" },
                r: {},
                bases: [],
                expected: { foo: "bar" },
            },
            "added on left, with a base": {
                l: { foo: "bar" },
                r: {},
                bases: [{}],
                expected: { foo: "bar" },
            },
            "added on right": {
                l: {},
                r: { foo: "bar" },
                bases: [{}],
                expected: { foo: "bar" },
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = SubmoduleConfigUtil.mergeUrls(c.l,
                                                             c.r,
                                                             c.bases);
                assert.deepEqual(result, c.expected);
            });
        });
    });
});

