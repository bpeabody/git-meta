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

const Commit          = require("../../lib/util/commit");
const GitUtil         = require("../../lib/util/git_util");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");
const RepoStatus      = require("../../lib/util/repo_status");
const StatusUtil      = require("../../lib/util/status_util");
const SubmoduleUtil   = require("../../lib/util/submodule_util");
const TestUtil        = require("../../lib/util/test_util");
const UserError       = require("../../lib/util/user_error");


// We'll always commit the repo named 'x'.  If a new commit is created ni the
// meta-repo, it will be named 'x'.  New commits created in sub-repos will be
// identified as their submodule name.

const committer = co.wrap(function *(doAll, message, repos, subMessages) {
    const x = repos.x;
    const status = yield Commit.getCommitStatus(x,
                                                x.workdir(), {
        showMetaChanges: true,
        all: doAll,
    });
    const result = yield Commit.commit(x, doAll, status, message, subMessages);
    let commitMap = {};
    if (null !== result.metaCommit) {
        commitMap[result.metaCommit] = "x";
    }
    Object.keys(result.submoduleCommits).forEach(subName => {
        const newCommit = result.submoduleCommits[subName];
        commitMap[newCommit] = subName;
    });
    return {
        commitMap: commitMap,
    };
});

describe("Commit", function () {
    const FILESTATUS = RepoStatus.FILESTATUS;
    const Submodule = RepoStatus.Submodule;
    const RELATION = RepoStatus.Submodule.COMMIT_RELATION;

    describe("stageChange", function () {
        const cases = {
            "one modified": {
                initial: "x=S:W README.md=99",
                path: "README.md",
                change: FILESTATUS.MODIFIED,
                expected: "x=S:I README.md=99",
            },
            "already staged but ok": {
                initial: "x=S:I README.md=99",
                path: "README.md",
                change: FILESTATUS.MODIFIED,
                expected: "x=S:I README.md=99",
            },
            "one removed": {
                initial: "x=S:W README.md",
                path: "README.md",
                change: FILESTATUS.REMOVED,
                expected: "x=S:I README.md",
            },
            "one already removed": {
                initial: "x=S:I README.md",
                path: "README.md",
                change: FILESTATUS.REMOVED,
                expected: "x=S:I README.md",
            },
            "added and modded": {
                initial: "x=S:I x=a;W x=b",
                path: "x",
                change: FILESTATUS.ADDED,
                expected: "x=S:I x=b",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            const manipulator = co.wrap(function *(repos) {
                const repo = repos.x;
                const index = yield repo.index();
                yield Commit.stageChange(index, c.path, c.change);
                yield index.write();
            });
            it(caseName, co.wrap(function *() {
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               c.expected,
                                                               manipulator,
                                                               c.fails);
            }));
        });
    });

    describe("prefixWithPound", function () {
        const cases = {
            "empty": {
                input: "",
                expected: "",
            },
            "one line": {
                input: "a\n",
                expected: "# a\n",
            },
            "one blank": {
                input: "\n",
                expected: "#\n",
            },
            "mixed": {
                input: `\

a

b

`,
                expected: `\
#
# a
#
# b
#
`
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = Commit.prefixWithPound(c.input);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("formatStatus", function () {
        const cases = {
            "nothing": {
                status: new RepoStatus(),
                expected: "",
            },
            "workdir": {
                status: new RepoStatus({
                    currentBranchName: "master",
                    staged: {
                        "foo": FILESTATUS.ADDED,
                    },
                    workdir: {
                        "bar": FILESTATUS.MODIFIED,
                    },
                }),
                expected: `\
Changes to be committed:
\tnew file:     foo

Changes not staged for commit:
\tmodified:     bar
`,
            },
            "untracked": {
                status: new RepoStatus({
                    currentBranchName: "master",
                    staged: {
                        "foo": FILESTATUS.ADDED,
                    },
                    workdir: {
                        "bar": FILESTATUS.ADDED,
                    },
                }),
                expected: `\
Changes to be committed:
\tnew file:     foo

Untracked files:
\tbar
`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const cwd = c.cwd || "";
                const result = Commit.formatStatus(c.status, cwd);
                const resultLines = result.split("\n");
                const expectedLines = c.expected.split("\n");
                assert.deepEqual(resultLines, expectedLines);
            });
        });
    });
    describe("formatEditorPrompt", function () {
        // Most of the work in this method is pass-through; just need to check
        // that it's all wired up.

        const cases = {
            "one change": {
                status: new RepoStatus({
                    currentBranchName: "master",
                    staged: {
                        "foo": FILESTATUS.ADDED,
                    },
                }),
                expected: `\

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
# On branch master.
# Changes to be committed:
# \tnew file:     foo
#
`,
            },
            "detached head": {
                status: new RepoStatus({
                    currentBranchName: null,
                    headCommit: "afafafafafafafafafafafafaf",
                    staged: {
                        "foo": FILESTATUS.ADDED,
                    },
                }),
                expected: `\

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
# On detached head afafaf.
# Changes to be committed:
# \tnew file:     foo
#
`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const cwd = c.cwd || "";
                const all = c.all || false;
                const result = Commit.formatEditorPrompt(c.status, cwd, all);
                const resultLines = result.split("\n");
                const expectedLines = c.expected.split("\n");
                assert.deepEqual(resultLines, expectedLines);
            });
        });
    });

    describe("getCommitStatus", function () {
        // We don't need to test the raw status reading operations here; those
        // are tested elsewhere.  We just need to test that all the arguments
        // are read and handled properly.

        const base = new RepoStatus({
            currentBranchName: "master",
            headCommit: "1",
        });

        const cases = {
            "trivial": {
                state: "x=S",
                expected: base,
            },
            "trivial with options": {
                state: "x=S",
                expected: base,
                options: {
                    all: false,
                    showMetaChanges: true,
                    paths: [],
                },
            },
            "no meta": {
                state: "x=S:W foo=bar",
                expected: base,
            },
            "with meta": {
                state: "x=S:W foo=bar",
                options: {
                    showMetaChanges: true,
                },
                expected: base.copy({
                    workdir: { foo: FILESTATUS.ADDED },
                }),
            },
            "without paths": {
                state: "x=S:I foo=bar,baz=bam",
                options: {
                    showMetaChanges: true,
                },
                expected: base.copy({
                    staged: {
                        foo: FILESTATUS.ADDED,
                        baz: FILESTATUS.ADDED,
                    },
                }),
            },
            "with paths": {
                state: "x=S:I foo/bar=bar,baz=bam",
                options: {
                    showMetaChanges: true,
                    paths: [ "foo" ],
                },
                expected: base.copy({
                    staged: {
                        "foo/bar": FILESTATUS.ADDED,
                    },
                    workdir: {
                        "baz": FILESTATUS.ADDED,
                    },
                }),
            },
            "without relative path": {
                state: "x=S:I foo/bar=bar,bar=bam",
                options: {
                    showMetaChanges: true,
                    paths: [ "bar" ],
                },
                expected: base.copy({
                    staged: {
                        "bar": FILESTATUS.ADDED,
                    },
                    workdir: {
                        "foo/bar": FILESTATUS.ADDED,
                    },
                }),
            },
            "with relative path": {
                state: "x=S:I foo/bar=bar,bar=bam",
                options: {
                    showMetaChanges: true,
                    paths: [ "bar" ],
                },
                workdir: "foo",
                expected: base.copy({
                    staged: {
                        "foo/bar": FILESTATUS.ADDED,
                    },
                    workdir: {
                        "bar": FILESTATUS.ADDED,
                    },
                }),
            },
            "without all": {
                state: "x=S:W README.md=88",
                options: {
                    showMetaChanges: true,
                },
                expected: base.copy({
                    workdir: {
                        "README.md": FILESTATUS.MODIFIED,
                    },
                }),
            },
            "with all": {
                state: "x=S:W README.md=88",
                options: {
                    showMetaChanges: true,
                    all: true,
                },
                expected: base.copy({
                    staged: {
                        "README.md": FILESTATUS.MODIFIED,
                    },
                }),
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const w = yield RepoASTTestUtil.createMultiRepos(c.state);
                const x = w.repos.x;
                let  workdir = x.workdir();
                if (undefined !== c.workdir) {
                    workdir = path.join(workdir, c.workdir);
                }
                const result = yield Commit.getCommitStatus(x,
                                                            workdir,
                                                            c.options);
                assert.instanceOf(result, RepoStatus);
                const mappedResult = StatusUtil.remapRepoStatus(result,
                                                                w.commitMap,
                                                                w.urlMap);
                assert.deepEqual(mappedResult, c.expected);
            }));
        });
    });

    describe("commit", function () {
        function makeCommitter(doAll, message, subMessages) {
            return function (repos) {
                return committer(doAll, message, repos, subMessages);
            };
        }
        const cases = {
            "simple nothing": {
                initial: "x=S",
                doAll: false,
                message: "",
                expected: {},
            },
            "nothing with all": {
                initial: "x=S",
                doAll: true,
                message: "",
                expected: {},
            },
            "staged addition": {
                initial: "x=S:I a=b",
                doAll: true,
                message: "hello",
                expected: "x=S:Chello#x-1 a=b;Bmaster=x",
            },
            "no meta message": {
                initial: "x=S:I a=b",
                doAll: true,
                message: null,
                subMessages: {},
            },
            "staged addition, unstaged modification but all": {
                initial: "x=S:I a=b;W a=c",
                doAll: true,
                message: "message",
                expected: "x=S:Cx-1 a=c;Bmaster=x",
            },
            "staged deletion": {
                initial: "x=S:I README.md",
                doAll: true,
                message: "message",
                expected: "x=S:Cx-1 README.md;Bmaster=x",
            },
            "staged modification": {
                initial: "x=S:I README.md=yyy",
                doAll: false,
                message: "message",
                expected: "x=S:Cx-1 README.md=yyy;Bmaster=x",
            },
            "unstaged addition": {
                initial: "x=S:W a=b",
                message: "foo",
                doAll: false,
                expected: {},
            },
            "unstaged addition, auto-stage": {
                initial: "x=S:W a=b",
                message: "foo",
                doAll: true,
                expected: {},
            },
            "unstaged deletion": {
                initial: "x=S:W README.md",
                message: "foo",
                doAll: false,
                expected: {},
            },
            "unstaged deletion, auto-stage": {
                initial: "x=S:W README.md",
                message: "message",
                doAll: true,
                expected: "x=S:Cx-1 README.md;Bmaster=x",
            },
            "unstaged modification": {
                initial: "x=S:W README.md=foo",
                message: "foo",
                doAll: false,
                expected: {},
            },
            "unstaged modification, auto-stage": {
                initial: "x=S:W README.md=foo",
                message: "message",
                doAll: true,
                expected: "x=S:Cx-1 README.md=foo;Bmaster=x",
            },
            "new submodule": {
                initial: "a=S|x=S:I s=Sa:1",
                message: "message",
                doAll: false,
                expected: "x=S:Cx-1 s=Sa:1;Bmaster=x",
            },
            "deleted submodule": {
                initial: "a=S|x=U:I s",
                message: "message",
                doAll: false,
                expected: "x=U:Cx-2 s;Bmaster=x",
            },
            "changed submodule url": {
                initial: "b=Aq|a=S|x=U:I s=Sb:q",
                message: "message",
                doAll: false,
                expected: "x=U:Cx-2 s=Sb:q;Bmaster=x",
            },
            "staged change in submodule": {
                initial: "a=S|x=U:Os I u=v",
                doAll: false,
                message: "message",
                expected:
                    "x=U:Cx-2 s=Sa:s;Os Cs-1 u=v!H=s;Bmaster=x",
            },
            "wd change in submodule": {
                initial: "a=S|x=U:Os W README.md=bar",
                message: "foo",
                doAll: false,
                expected: {},
            },
            "wd change in submodule -- auto-stage": {
                initial: "a=S|x=U:Os W README.md=bar",
                message: "message",
                doAll: true,
                expected: `
x=U:Cx-2 s=Sa:s;Os Cs-1 README.md=bar!H=s;Bmaster=x`,
            },
            "wd addition in submodule -- auto-stage": {
                initial: "a=S|x=U:Os W foo=baz",
                message: "foo",
                doAll: true,
                expected: {},
            },

            // Note that Git will put the first commit on branch `master`
            // without being asked to.  I don't think this behavior is onerous
            // enought to code around it; instead, we will account for it in
            // our test case.

            "new sub no commits, stage": {
                initial: "a=B|x=S:I s=Sa:;Os I q=r",
                doAll: false,
                message: "message",
                expected: `
x=E:Cx-1 s=Sa:s;I s=~;Os Cs q=r!*=master!Bmaster=s;Bmaster=x`,
            },
            "new sub with commits": {
                initial: "a=B|x=Ca:I s=S.:;Os Cz!H=z",
                doAll: false,
                message: "message",
                expected: `x=E:Cx-1 s=S.:z;Bmaster=x;I s=~`,
            },
            "staged commit in index undone in workdir": {
                initial: `
q=B:Cz-1;Bmaster=z|x=S:C2-1 s=Sq:1;I s=Sq:z,x=Sq:1;Bmaster=2;Os H=1`,
                doAll: false,
                message: "message",
                expected: `
x=E:Cx-2 x=Sq:1;Bmaster=x;I s=~,x=~`,
            },
            "staged change in submodule, not mentioned": {
                initial: "a=S|x=U:Os I u=v",
                doAll: false,
                message: null,
                subMessages: {},
            },
            "staged change in submodule, mentioned": {
                initial: "a=S|x=U:Os I u=v",
                doAll: false,
                message: null,
                subMessages: {
                    s: "this message",
                },
                expected: "x=E:Os Cthis message#s-1 u=v!H=s",
            },
            "staged change in submodule with commit override": {
                initial: "a=S|x=U:Os I u=v",
                doAll: false,
                message: "message",
                subMessages: {
                    s: "this message",
                },
                expected:
                    "x=U:Cx-2 s=Sa:s;Os Cthis message#s-1 u=v!H=s;Bmaster=x",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const manipulator = makeCommitter(c.doAll,
                                                  c.message,
                                                  c.subMessages);
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               c.expected,
                                                               manipulator,
                                                               c.fails);
            }));
        });
    });

    describe("sameCommitInstance", function () {
        const cases = {
            "same weird": {
                xName: "foo",
                xEmail: "foo@bar",
                xMessage: "because",
                yName: "foo",
                yEmail: "foo@bar",
                yMessage: "because",
                expected: true,
            },
            "diff name": {
                xName: "baz",
                xEmail: "foo@bar",
                xMessage: "because",
                yName: "foo",
                yEmail: "foo@bar",
                yMessage: "because",
                expected: false,
            },
            "diff email": {
                xName: "foo",
                xEmail: "foo@baz",
                xMessage: "because",
                yName: "foo",
                yEmail: "foo@bar",
                yMessage: "because",
                expected: false,
            },
            "diff message": {
                xName: "foo",
                xEmail: "foo@bar",
                xMessage: "because",
                yName: "foo",
                yEmail: "foo@bar",
                yMessage: "why",
                expected: false,
            },
            "all different": {
                xName: "bar",
                xEmail: "bam@bar",
                xMessage: "because",
                yName: "foo",
                yEmail: "foo@bar",
                yMessage: "why",
                expected: false,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const repo = yield TestUtil.createSimpleRepository();
                const readmePath = path.join(repo.workdir(), "README.md");
                const makeCommit = co.wrap(function *(name, email, message) {
                    yield fs.appendFile(readmePath, "foo");
                    const sig = NodeGit.Signature.now(name, email);
                    return yield repo.createCommitOnHead(["README.md"],
                                                         sig,
                                                         sig,
                                                         message);
                });
                const xCommitId = yield makeCommit(c.xName,
                                                   c.xEmail,
                                                   c.xMessage);
                const yCommitId = yield makeCommit(c.yName,
                                                   c.yEmail,
                                                   c.yMessage);
                const xCommit = yield repo.getCommit(xCommitId);
                const yCommit = yield repo.getCommit(yCommitId);
                const result = Commit.sameCommitInstance(xCommit, yCommit);
                assert.equal(result, c.expected);
            }));
        });
    });

    describe("checkIfRepoIsAmendable", function () {
        const cases = {
            "trivial, no subs": {
                input: "x=S",
            },
            "ok, new sub": {
                input: "a=B|x=U",
            },
            "sub with good commit": {
                input: "a=B:Ca-1;Bf=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
            },
            "sub with good commit, need to open": {
                input: "a=B:Ca-1;Bf=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
            },
            "sub with new commit in index": {
                input: `
a=B:Ca-1;Cb-a;Bf=b|
x=U:C3-2 s=Sa:a;Bmaster=3;I s=Sa:b`,
                newCommits: { s: RELATION.UNKNOWN },
            },
            "sub with new commit in workdir": {
                input: `
a=B:Ca-1;Cb-a;Bf=b|
x=U:C3-2 s=Sa:a;Bmaster=3;Os H=b`,
                newCommits: { s: RELATION.AHEAD },
            },
            "sub with bad commit": {
                input: "a=B:Ca message#a-1;Bf=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
                mismatchCommits: ["s"],
            },
            "bad, mismatch, and good": {
                input: `
a=B:Ca-1;Cb-a;Ccommit me#c-b;Bf=c|
x=S:C2-1 s=Sa:1,t=Sa:1,u=Sa:1;C3-2 s=Sa:b,t=Sa:b,u=Sa:c;I t=Sa:1;Bmaster=3`,
                mismatchCommits: ["u"],
                newCommits: { t: RELATION.UNKNOWN },
                newStatusSubs: ["s", "u"],
            },
            "deleted": {
                input: `a=B|x=U:I s`,
                deleted: ["s"],
            }
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const written =
                               yield RepoASTTestUtil.createMultiRepos(c.input);
                const repos = written.repos;
                const repo = repos.x;
                const status = yield StatusUtil.getRepoStatus(repo, {
                    showMetaChanges: true,
                });
                const head = yield repo.getHeadCommit();
                let oldSubs = {};
                const parent = yield GitUtil.getParentCommit(repo, head);
                if (null !== parent) {
                    oldSubs =
                      yield SubmoduleUtil.getSubmodulesForCommit(repo, parent);
                }
                const result = yield Commit.checkIfRepoIsAmendable(repo,
                                                                   status,
                                                                   oldSubs);
                assert.deepEqual(result.deleted.sort(),
                                 c.deleted || [],
                                 "deleted");
                assert.deepEqual(result.newCommits,
                                 c.newCommits || {},
                                 "newCommits");
                assert.deepEqual(result.mismatchCommits.sort(),
                                 c.mismatchCommits || [],
                                 "mismatchCommits");
                let subs = status.submodules;
                const newSubs = c.newStatusSubs || [];
                newSubs.forEach(name => {
                    subs[name] = subs[name].open();
                });
                const newStatus = status.copy({ submodules: subs });
                const remappedResult = StatusUtil.remapRepoStatus(
                                                             result.status,
                                                             written.commitMap,
                                                             written.urlMap);
                const remappedExpected = StatusUtil.remapRepoStatus(
                                                             newStatus,
                                                             written.commitMap,
                                                             written.urlMap);
                assert.deepEqual(remappedResult, remappedExpected);
            }));
        });
    });

    describe("getAmendChanges", function () {
        const cases = {
            "trivial, no meta": {
                input: "x=S",
            },
            "meta with no parent": {
                input: "x=S",
                includeMeta: true,
                staged: { "README.md": FILESTATUS.ADDED },
            },
            "meta without all": {
                input: "x=S:C2-1;Bmaster=2;W 2=3",
                includeMeta: true,
                staged: { "2": FILESTATUS.ADDED},
                workdir: { "2": FILESTATUS.MODIFIED },
            },
            "meta with all": {
                input: "x=S:C2-1;Bmaster=2;W README.md=hi",
                staged: { 
                    "2": FILESTATUS.ADDED,
                    "README.md": FILESTATUS.MODIFIED,
                },
                all: true,
                includeMeta: true,
            },
            "meta with new sub": {
                input: "x=U",
            },
            "meta with deleted sub": {
                input: "x=U:C3-2 s;Bmaster=3",
            },
            "meta with unchanged sub": {
                input: "x=U:C3-2;Bmaster=3",
            },
            "meta with open unchanged sub": {
                input: "a=B|x=U:C3-2;Bmaster=3;Os",
            },
            "sub with new commit, no parent": {
                input: "a=B:Ca;Bmaster=a;Bx=1|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
                submodulesToAmend: {
                    "s": {
                        staged: { "a": FILESTATUS.ADDED},
                        workdir: {},
                    },
                },
            },
            "sub with new commit": {
                input: "a=B:Ca-1;Bmaster=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
                submodulesToAmend: {
                    "s": {
                        staged: { "a": FILESTATUS.ADDED},
                        workdir: {},
                    },
                },
            },
            "sub with new commit, modification, no all": {
                input: `
a=B:Ca-1;Bmaster=a|
x=U:C3-2 s=Sa:a;Bmaster=3;Os W README.md=foo`,
                submodulesToAmend: {
                    "s": {
                        staged: { "a": FILESTATUS.ADDED},
                        workdir: { "README.md": FILESTATUS.MODIFIED },
                    },
                },
            },
            "sub with new commit, modification, all": {
                input: `
a=B:Ca-1;Bmaster=a|
x=U:C3-2 s=Sa:a;Bmaster=3;Os W README.md=foo`,
                submodulesToAmend: {
                    "s": {
                        staged: {
                            "a": FILESTATUS.ADDED,
                            "README.md": FILESTATUS.MODIFIED,
                        },
                        workdir: {},
                    },
                },
                all: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const written =
                               yield RepoASTTestUtil.createMultiRepos(c.input);
                const repos = written.repos;
                const repo = repos.x;
                const includeMeta = c.includeMeta || false;
                const all = c.all || false;
                const status = yield StatusUtil.getRepoStatus(repo, {
                    showMetaChanges: includeMeta,
                });
                const head = yield repo.getHeadCommit();
                let oldSubs = {};
                const parent = yield GitUtil.getParentCommit(repo, head);
                if (null !== parent) {
                    oldSubs =
                      yield SubmoduleUtil.getSubmodulesForCommit(repo, parent);
                }
                const result = yield Commit.getAmendChanges(repo,
                                                            oldSubs,
                                                            status,
                                                            includeMeta,
                                                            all);
                // Translate the test case data into expected data:
                // 1. generate a list of expected sub names from the submodule
                //    changes listed in the test case
                // 2. recreate the submodule in status with the staged/workdir
                //    changes listed in the test case
                // 3. remap both result and expected status based on commit/url
                //    remappings so the diff will make sense

                const staged = c.staged || {};
                const workdir = c.workdir || {};
                const submodulesToAmend = c.submodulesToAmend || {};
                const expectedSubNames = [];
                const expectedSubmodules = status.submodules;
                Object.keys(submodulesToAmend).forEach(subName => {
                    expectedSubNames.push(subName);
                    const expected = submodulesToAmend[subName];
                    const sub = expectedSubmodules[subName];
                    const newStatus = sub.workdir.status.copy({
                        staged: expected.staged,
                        workdir: expected.workdir,
                    });
                    const newWd = new RepoStatus.Submodule.Workdir(
                                                                newStatus,
                                                                RELATION.SAME);
                    expectedSubmodules[subName] = sub.copy({
                        workdir: newWd,
                    });
                });
                const expected = status.copy({
                    staged: staged,
                    workdir: workdir,
                    submodules: expectedSubmodules,
                });
                const mappedExpected = StatusUtil.remapRepoStatus(
                                                             expected,
                                                             written.commitMap,
                                                             written.urlMap);
                const mappedResult= StatusUtil.remapRepoStatus(
                                                             result.status,
                                                             written.commitMap,
                                                             written.urlMap);
                assert.deepEqual(result.subsToAmend.sort(),
                                 expectedSubNames.sort());
                assert.deepEqual(mappedResult, mappedExpected);
            }));
        });
    });

    describe("amendRepo", function () {
        const cases = {
            "trivial": {
                input: "x=S",
                message: "foo",
                expected: `
x=N:Cfoo#x README.md=hello world;*=master;Bmaster=x`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const amend = co.wrap(function *(repos) {
                    const repo = repos.x;
                    const newSha = yield Commit.amendRepo(repo, c.message);
                    const commitMap = {};
                    commitMap[newSha] = "x";
                    return { commitMap: commitMap };
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.input,
                                                               c.expected,
                                                               amend,
                                                               c.fails);
            }));
        });
    });

    describe("amendMetaRepo", function () {
        // Most of the logic surrounding committing is handled in previously
        // tested codepaths.  We need to verify that it's all tied together
        // properly, that submodules are properly staged, and that when there
        // is no difference between the current state and the base commit, we
        // strip the last commit.

        // We'll use the repo `x` and name created commits as `am` for the
        // meta-repo and `a<sub name>` for commits in submodules.

        const cases = {
            "trivial": {
                input: "x=N:Cm#1;H=1",
                expected: "x=N:Cam 1=1;H=am",
            },
            "meta change": {
                input: "x=S:C2-1;Bmaster=2;I README.md=3",
                expected: "x=S:Cam-1 README.md=3,2=2;Bmaster=am",
            },
            "meta staged": {
                input: "x=S:C2-1;Bmaster=2;W README.md=3",
                expected: "x=S:Cam-1 README.md=3,2=2;Bmaster=am",
                all: true,
            },
            "repo with new sha in index": {
                input: "a=B:Ca-1;Bmaster=a|x=U:C3-2;I s=Sa:a;Bmaster=3",
                expected: "x=U:Cam-2 3=3,s=Sa:a;Bmaster=am",
            },
            "repo with new head in workdir": {
                input: "a=B:Ca-1;Bmaster=a|x=U:C3-2;Bmaster=3;Os H=a",
                expected: "x=U:Cam-2 3=3,s=Sa:a;Bmaster=am;Os",
            },
            "repo with staged workdir changes": {
                input: "a=B|x=U:C3-2;Bmaster=3;Os I x=x",
                expected: `x=U:Cam-2 3=3,s=Sa:as;Bmaster=am;Os Cas-1 x=x!H=as`,
            },
            "repo with unstaged workdir changes": {
                input: "a=B|x=U:C3-2;Bmaster=3;Os W README.md=3",
                expected: `
x=U:Cam-2 3=3,s=Sa:as;Bmaster=am;Os Cas-1 README.md=3!H=as`,
                all: true,
            },
            "repo with staged and unstaged workdir changes": {
                input: "a=B|x=U:C3-2;Bmaster=3;Os I a=b!W README.md=3",
                expected: `
x=U:Cam-2 3=3,s=Sa:as;Bmaster=am;Os Cas-1 a=b,README.md=3!H=as`,
                all: true,
            },
            "amended subrepo": {
                input: "a=B:Ca-1;Bx=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os",
                message: "hi",
                expected: `
x=U:Chi#am-2 s=Sa:as;Bmaster=am;Os Chi#as-1 a=a!H=as`,
            },
            "amended subrepo with index change": {
                input: "a=B:Ca-1;Bx=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os I q=4",
                message: "hi",
                expected: `
x=U:Chi#am-2 s=Sa:as;Bmaster=am;Os Chi#as-1 a=a,q=4!H=as`,
            },
            "amended subrepo with unstaged change": {
                input: `
a=B:Ca-1;Bx=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os W README.md=2`,
                message: "hi",
                expected: `
x=U:Chi#am-2 s=Sa:as;Bmaster=am;Os Chi#as-1 a=a!H=as!W README.md=2`,
            },
            "amended subrepo with change to stage": {
                input: `
a=B:Ca-1;Bx=a|x=U:C3-2 s=Sa:a;Bmaster=3;Os W README.md=2`,
                message: "hi",
                expected: `
x=U:Chi#am-2 s=Sa:as;Bmaster=am;Os Chi#as-1 a=a,README.md=2!H=as`,
                all: true,
            },
            "strip submodule commit": {
                input: `
a=B:Ca-1;Bmaster=a|x=U:C3-2 s=Sa:a,3=3;Os I a;Bmaster=3`,
                message: "foo",
                expected: `x=U:Cfoo#am-2 3=3;Bmaster=am;Os`,
            },
            "strip submodule commit, leave untracked": {
                input: `
a=B:Ca-1;Bmaster=a|x=U:C3-2 s=Sa:a,3=3;Os I a!W x=y;Bmaster=3`,
                message: "foo",
                expected: `x=U:Cfoo#am-2 3=3;Bmaster=am;Os W x=y`,
            },
            "strip submodule commit, leave modified": {
                input: `
a=B:Ca-1;Bmaster=a|x=U:C3-2 s=Sa:a,3=3;Os I a!W README.md=2;Bmaster=3`,
                message: "foo",
                expected: `x=U:Cfoo#am-2 3=3;Bmaster=am;Os W README.md=2`,
            },
            "strip submodule commit unchange from index": {
                input: `
a=B:Ca-1;Cb-a a=9;Bmaster=b|x=U:C3-2 s=Sa:b,3=3;Os I a=a;Bmaster=3`,
                message: "foo",
                expected: `x=U:Cfoo#am-2 3=3,s=Sa:a;Bmaster=am;Os`
            },
            "not strip submodule commit unchange from workdir": {
                input: `
a=B:Ca-1;Cb-a a=9;Bmaster=b|x=U:C3-2 s=Sa:b,3=3;Os W a=a;Bmaster=3`,
                message: "foo",
                expected: `
x=U:Cfoo#am-2 3=3,s=Sa:as;Bmaster=am;Os Cfoo#as-a a=9!W a=a`
            },
            "strip submodule commit unchange from workdir, when all": {
                input: `
a=B:Ca-1;Cb-a a=9;Bmaster=b|x=U:C3-2 s=Sa:b,3=3;Os W a=a;Bmaster=3`,
                message: "foo",
                expected: `x=U:Cfoo#am-2 3=3,s=Sa:a;Bmaster=am;Os`,
                all: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const amender = co.wrap(function *(repos) {
                    const repo = repos.x;
                    const all = c.all || false;
                    const status = yield Commit.getCommitStatus(
                                                              repo,
                                                              repo.workdir(), {
                        showMetaChanges: true,
                        all: all,
                    });
                    const head = yield repo.getHeadCommit();
                    let oldSubs = {};
                    const parent = yield GitUtil.getParentCommit(repo, head);
                    if (null !== parent) {
                        oldSubs = yield SubmoduleUtil.getSubmodulesForCommit(
                                                                       repo,
                                                                       parent);
                    }

                    // We're going to give "true" for including meta changes.
                    // It's not a flag that goes to the method we're testing,
                    // so we can control it by whether or not we have things to
                    // commit in the meta-repo.

                    const amend = yield Commit.getAmendChanges(repo,
                                                               oldSubs,
                                                               status,
                                                               true,
                                                               all);
                    const message = c.message || "message";
                    const result = yield Commit.amendMetaRepo(
                                                             repo,
                                                             amend.status,
                                                             amend.subsToAmend,
                                                             all,
                                                             message);
                    const commitMap = {};
                    commitMap[result.meta] = "am";
                    Object.keys(result.subs).forEach(subName => {
                        commitMap[result.subs[subName]] = "a" + subName;
                    });
                    return { commitMap: commitMap, };
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.input,
                                                               c.expected,
                                                               amender,
                                                               c.fails);
            }));
        });
    });

    describe("formatAmendEditorPrompt", function () {
        // Mostly, this method chains some other methods together.  We just
        // need to do a couple of tests to validate that things are hooked up,
        // and that it omits the author when it's unchanged between the current
        // and previous signatures.

        const defaultSig = NodeGit.Signature.now("bob", "bob@bob");

        const cases = {
            "change to meta": {
                status: new RepoStatus({
                    currentBranchName: "a-branch",
                    staged: {
                        "bam/baz": FILESTATUS.ADDED,
                    },
                }),
                date: "NOW",
                expected: `\

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# Date:      NOW
#
# On branch a-branch.
# Changes to be committed:
# \tnew file:     bam/baz
#
`,
            },
            "change to meta, different author": {
                status: new RepoStatus({
                    currentBranchName: "a-branch",
                    staged: {
                        "bam/baz": FILESTATUS.ADDED,
                    },
                }),
                date: "NOW",
                commitSig: NodeGit.Signature.now("jill", "jill@jill"),
                expected: `\

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# Author:    jill <jill@jill>
# Date:      NOW
#
# On branch a-branch.
# Changes to be committed:
# \tnew file:     bam/baz
#
`,
            },
            "different cwd": {
                status: new RepoStatus({
                    currentBranchName: "a-branch",
                    staged: {
                        "bam/baz": FILESTATUS.ADDED,
                    },
                }),
                cwd: "bam",
                date: "NOW",
                expected: `\

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# Date:      NOW
#
# On branch a-branch.
# Changes to be committed:
# \tnew file:     baz
#
`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const commitSig = c.commitSig || defaultSig;
                const repoSig = c.repoSig || defaultSig;
                const cwd = c.cwd || "";
                const result = Commit.formatAmendEditorPrompt(commitSig,
                                                              repoSig,
                                                              c.status,
                                                              cwd,
                                                              c.date);

                const resultLines = result.split("\n");
                const expectedLines = c.expected.split("\n");
                assert.deepEqual(resultLines, expectedLines);
            });
        });
    });

    describe("calculatePathCommitStatus", function () {
        const cases = {
            "trivial": {
                cur: new RepoStatus(),
                req: new RepoStatus(),
                exp: new RepoStatus(),
            },
            "no cur": {
                cur: new RepoStatus(),
                req: new RepoStatus({
                    staged: { foo: FILESTATUS.ADDED },
                }),
                exp: new RepoStatus({
                    staged: { foo: FILESTATUS.ADDED },
                }),
            },
            "no cur, from workdir": {
                cur: new RepoStatus(),
                req: new RepoStatus({
                    workdir: { foo: FILESTATUS.MODIFIED },
                }),
                exp: new RepoStatus({
                    staged: { foo: FILESTATUS.MODIFIED },
                }),
            },
            "no cur, ignore added": {
                cur: new RepoStatus(),
                req: new RepoStatus({
                    workdir: { foo: FILESTATUS.ADDED },
                }),
                exp: new RepoStatus(),
            },
            "no requested": {
                cur: new RepoStatus({
                    staged: { foo: FILESTATUS.MODIFIED },
                }),
                req: new RepoStatus(),
                exp: new RepoStatus({
                    workdir: { foo: FILESTATUS.MODIFIED },
                }),
            },
            "requested overrides": {
                cur:  new RepoStatus({
                    staged: {
                        foo: FILESTATUS.MODIFIED,
                        ugh: FILESTATUS.ADDED,
                    },
                    workdir: {
                        bar: FILESTATUS.MODIFIED,
                        baz: FILESTATUS.REMOVED,
                    },
                }),
                req: new RepoStatus({
                    staged: { foo: FILESTATUS.ADDED },
                    workdir: { bar: FILESTATUS.MODIFIED },
                }),
                exp: new RepoStatus({
                    staged: {
                        foo: FILESTATUS.ADDED,
                        bar: FILESTATUS.MODIFIED,
                    },
                    workdir: {
                        ugh: FILESTATUS.ADDED,
                        baz: FILESTATUS.REMOVED,
                    },
                }),
            },
            "in a sub, no cur": {
                cur: new RepoStatus({
                    submodules: {
                        s: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "1",
                            }), RELATION.SAME),
                        }),
                    },
                }),
                req: new RepoStatus({
                    submodules: {
                        s: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "1",
                                staged: { foo: FILESTATUS.ADDED },
                            }), RELATION.SAME),
                        }),
                    },
                }),
                exp: new RepoStatus({
                    submodules: {
                        s: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "1",
                                staged: { foo: FILESTATUS.ADDED },
                            }), RELATION.SAME),
                        }),
                    },
                }),
            },
            "unrequested sub": {
                cur: new RepoStatus({
                    submodules: {
                        xxx: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "1",
                                staged: {
                                    xxx: FILESTATUS.MODIFIED,
                                },
                            }), RELATION.SAME),
                        }),
                    },
                }),
                req: new RepoStatus(),
                exp: new RepoStatus({
                    submodules: {
                        xxx: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "1",
                                workdir: {
                                    xxx: FILESTATUS.MODIFIED,
                                },
                            }), RELATION.SAME),
                        }),
                    },
                }),
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = Commit.calculatePathCommitStatus(c.cur, c.req);
                assert.deepEqual(result, c.exp);
            });
        });
    });

    describe("writeRepoPaths", function () {

        // Will apply commit to repo `x` and name the created commit `x`.
        const cases = {
            "simple staged change": {
                state: "x=S:I README.md=haha",
                fileChanges: {
                    "README.md": FILESTATUS.MODIFIED,
                },
                expected: "x=S:Cx-1 README.md=haha;Bmaster=x",
            },
            "simple workdir change": {
                state: "x=S:W README.md=haha",
                fileChanges: { "README.md": FILESTATUS.MODIFIED, },
                expected: "x=S:Cx-1 README.md=haha;Bmaster=x",
            },
            "simple change with message": {
                state: "x=S:I README.md=haha",
                fileChanges: { "README.md": FILESTATUS.MODIFIED, },
                expected: "x=S:Chello world#x-1 README.md=haha;Bmaster=x",
                message: "hello world",
            },
            "added file": {
                state: "x=S:W q=3",
                fileChanges: { "q": FILESTATUS.ADDED },
                expected: "x=S:Cx-1 q=3;Bmaster=x",
            },
            "added two files, but mentioned only one": {
                state: "x=S:W q=3,r=4",
                fileChanges: { "q": FILESTATUS.ADDED },
                expected: "x=S:Cx-1 q=3;W r=4;Bmaster=x",
            },
            "staged a change and didn't mention it": {
                state: "x=S:W q=3;I r=4",
                fileChanges: { "q": FILESTATUS.ADDED },
                expected: "x=S:Cx-1 q=3;I r=4;Bmaster=x",
            },
            "staged a change and did mention it": {
                state: "x=S:W q=3;I r=4",
                fileChanges: {
                    "q": FILESTATUS.ADDED,
                    "r": FILESTATUS.ADDED,
                },
                expected: "x=S:Cx-1 q=3,r=4;Bmaster=x",
            },
            "deep path": {
                state: "x=S:W a/b/c=2",
                fileChanges: {
                    "a/b/c": FILESTATUS.ADDED,
                },
                expected: "x=S:Cx-1 a/b/c=2;Bmaster=x",
            },
            "submodule": {
                state: "a=B:Ca-1;Bm=a|x=U:I s=Sa:a",
                subChanges: ["s"],
                expected: "x=E:Cx-2 s=Sa:a;Bmaster=x;I s=~",
            },
            "submodule in workdir": {
                state: "a=B:Ca-1;Bm=a|x=U:Os H=a",
                subChanges: ["s"],
                expected: "x=E:Cx-2 s=Sa:a;Bmaster=x",
            },
            "ignored a sub": {
                state: "a=B:Ca-1;Bm=a|x=U:Os H=a;W foo=bar",
                fileChanges: {
                    "foo": FILESTATUS.ADDED,
                },
                subChanges: [],
                expected: "x=E:Cx-2 foo=bar;Bmaster=x;W foo=~",
            },
            "deep sub": {
                state: `
a=B:Ca-1;Bm=a|
x=S:C2-1 q/r/s=Sa:1;Bmaster=2;Oq/r/s H=a`,
                subChanges: ["q/r/s"],
                expected: "x=E:Cx-2 q/r/s=Sa:a;Bmaster=x",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            const writer = co.wrap(function *(repos) {
                const repo = repos.x;
                let status = yield StatusUtil.getRepoStatus(repo);
                const message = c.message || "message";
                const subChanges = c.subChanges || [];
                const subs = {};
                const submodules = status.submodules;
                subChanges.forEach(subName => {
                    subs[subName] = submodules[subName];
                });
                status = status.copy({
                    staged: c.fileChanges || {},
                    submodules: subs,
                });
                const result = yield Commit.writeRepoPaths(repo,
                                                           status,
                                                           message);
                const commitMap = {};
                commitMap[result] = "x";
                return { commitMap: commitMap, };

            });
            it(caseName, co.wrap(function *() {
                yield RepoASTTestUtil.testMultiRepoManipulator(c.state,
                                                               c.expected,
                                                               writer,
                                                               c.fails);
            }));
        });
    });

    describe("commitPaths", function () {
        // Most of the logic here is delegated to the previously tested method
        // 'writeRepo'.

        const cases = {
            "one file": {
                state: "x=S:C2-1 x=y;W x=q;Bmaster=2",
                paths: ["x"],
                expected: "x=E:Cx-2 x=q;W x=~;Bmaster=x",
            },
            "skip a file": {
                state: "x=S:C2-1 x=y;I a=b;W x=q;Bmaster=2",
                paths: ["x"],
                expected: "x=E:Cx-2 x=q;W x=~;Bmaster=x",
            },
            "files in a tree": {
                state: "x=S:I x/y=2,x/z=3,y/r=4",
                paths: ["x"],
                expected: "x=E:Cx-1 x/y=2,x/z=3;I x/y=~,x/z=~;Bmaster=x"
            },
            "files in a submodule": {
                state: "a=B:Ca-1;Bm=a|x=U:Os I q=r",
                paths: ["s"],
                expected: "x=E:Cx-2 s=Sa:s;Os Cs-1 q=r!H=s;Bmaster=x",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const committer = co.wrap(function *(repos) {
                    const repo = repos.x;
                    const status = yield Commit.getCommitStatus(
                                                              repo,
                                                              repo.workdir(), {
                        showMetaChanges: true,
                        paths: c.paths,
                    });
                    const message = c.message || "message";
                    const result = yield Commit.commitPaths(repo,
                                                            status,
                                                            message);
                    const commitMap = {};
                    commitMap[result.metaCommit] = "x";
                    Object.keys(result.submoduleCommits).forEach(name => {
                        const sha = result.submoduleCommits[name];
                        commitMap[sha] = name;
                    });
                    return { commitMap: commitMap };
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.state,
                                                               c.expected,
                                                               committer,
                                                               c.fails);
            }));
        });
    });

    describe("areSubmodulesIncompatibleWithPathCommits", function () {
        const cases = {
            "trivial": {
                input: new RepoStatus(),
                expected: false,
            },
            "good submodule": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                        }),
                    },
                }),
                expected: false,
            },
            "new sub": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            index: new Submodule.Index(null, "/a", null),
                        }),
                    },
                }),
                expected: true,
            },
            "removed sub": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                        }),
                    },
                }),
                expected: true,
            },
            "new URL": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/b",
                                                       RELATION.SAME),
                        }),
                    },
                }),
                expected: true,
            },
            "new index commit": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("2",
                                                       "/a",
                                                       RELATION.AHEAD),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "2",
                                staged: {
                                    q: FILESTATUS.ADDED,
                                },
                            }), RELATION.SAME)
                        }),
                    },
                }),
                expected: true,
            },
            "new index commit, workdir change": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("2",
                                                       "/a",
                                                       RELATION.AHEAD),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "2",
                                workdir: {
                                    q: FILESTATUS.MODIFIED,
                                },
                            }), RELATION.SAME)
                        }),
                    },
                }),
                expected: false,
            },
            "new workdir commit": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(new RepoStatus({
                                headCommit: "2",
                                staged: {
                                    q: FILESTATUS.ADDED,
                                },
                            }), RELATION.AHEAD),
                        }),
                    },
                }),
                expected: true,
            },
            "bad and good submodule": {
                input: new RepoStatus({
                    submodules: {
                        x: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                        }),
                        y: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/b",
                                                       RELATION.SAME),
                        }),
                    },
                }),
                expected: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result =
                      Commit.areSubmodulesIncompatibleWithPathCommits(c.input);
                assert.equal(result, c.expected);
            });
        });
    });

    describe("calculateAllStatus", function () {
        const cases = {
            "trivial": {
                staged: {},
                workdir: {},
                expected: {
                    staged: {},
                    workdir: {},
                },
            },
            "ignore normal staged": {
                staged: { foo: FILESTATUS.ADDED, },
                workdir: {},
                expected: {
                    staged: {},
                    workdir: {},
                },
            },
            "ignore normal workdir": {
                staged: { foo: FILESTATUS.ADDED, },
                workdir: {},
                expected: {
                    staged: {},
                    workdir: {},
                },
            },
            "copy workdir mod": {
                staged: {},
                workdir: {
                    foo: FILESTATUS.MODIFIED,
                },
                expected: {
                    staged: {
                        foo: FILESTATUS.MODIFIED,
                    },
                    workdir: {},
                },
            },
            "added and staged": {
                staged: {
                    bar: FILESTATUS.ADDED,
                },
                workdir: {
                    bar: FILESTATUS.ADDED,
                },
                expected: {
                    staged: {
                        bar: FILESTATUS.ADDED,
                    },
                    workdir: {},
                },
            },
            "added but not staged": {
                staged: {},
                workdir: {
                    foo: FILESTATUS.ADDED,
                },
                expected: {
                    staged: {},
                    workdir: {
                        foo: FILESTATUS.ADDED,
                    },
                },
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                const result = Commit.calculateAllStatus(c.staged, c.workdir);
                assert.deepEqual(result, c.expected);
            });
        });
    });

    describe("calculateAllRepoStatus", function () {
        // We don't need to test the logic already tested in
        // `calculateAllStatus` here, just that we call it correctly and
        // properly assemble the sub-parts, e.g., the submodules.

        const cases = {
            "trivial": {
                normal: new RepoStatus(),
                toWorkdir: new RepoStatus(),
                expected: new RepoStatus(),
            },
            "read correctly from staged": {
                normal: new RepoStatus({
                    staged: { foo: FILESTATUS.ADDED, },
                }),
                toWorkdir: new RepoStatus(),
                expected: new RepoStatus(),
            },
            "read correctly from workdir": {
                normal: new RepoStatus(),
                toWorkdir: new RepoStatus({
                    workdir: {
                        foo: FILESTATUS.MODIFIED,
                    },
                }),
                expected: new RepoStatus({
                    staged: {
                        foo: FILESTATUS.MODIFIED,
                    },
                }),
            },

            // We don't need to retest the logic exhaustively with submodules,
            // just that closed submodules are handled and that the basic logic
            // is correctly applied to open submodules.

            "with a submodule": {
                normal: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                        }),
                    },
                }),
                toWorkdir: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                        }),
                    },
                }),
            },
            "with a submodule with untracked changes": {
                normal: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                toWorkdir: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    workdir: {
                                        foo: FILESTATUS.ADDED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    workdir: {
                                        foo: FILESTATUS.ADDED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
            },
            "with a submodule with changes to stage": {
                normal: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                toWorkdir: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    workdir: {
                                        foo: FILESTATUS.MODIFIED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    staged: {
                                        foo: FILESTATUS.MODIFIED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
            },
        };
        Object.keys(cases).forEach(caseName => {
            it(caseName, function () {
                const c = cases[caseName];
                const result = Commit.calculateAllRepoStatus(c.normal,
                                                             c.toWorkdir);
                assert.deepEqual(result, c.expected);
            });
        });
    });

    describe("removeSubmoduleChanges", function () {
        const cases = {
            "trivial": {
                input: new RepoStatus(),
                expected: new RepoStatus(),
            },
            "some data in base": {
                input: new RepoStatus({
                    headCommit: "1",
                    currentBranchName: "foo",
                }),
                expected: new RepoStatus({
                    headCommit: "1",
                    currentBranchName: "foo",
                }),
            },
            "closed sub": {
                input: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                        }),
                    },
                }),
            },
            "open and unchanged": {
                input: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
            },
            "open and changed": {
                input: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    staged: { foo: FILESTATUS.ADDED },
                                    workdir: { bar: FILESTATUS.MODIFIED },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: new RepoStatus({
                    submodules: {
                        foo: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = Commit.removeSubmoduleChanges(c.input);
                assert.deepEqual(result, c.expected);
            });
        });
    });

    describe("formatSplitCommitEditorPrompt", function () {
        // Here, we don't need to test the details of formatting that are
        // tested elsewhere, just that we pull it all together, including,
        // especially
        const cases = {
            // This case couldn't actually be used to generate a commit, but it
            // is the simplest case.

            "just on a branch": {
                input: new RepoStatus({
                    currentBranchName: "master",
                }),
                expected: `\

# <*> enter meta-repo message above this line; delete to commit only submodules
# On branch master.
#
# Please enter the commit message(s) for your changes.  The message for a
# repo will be composed of all lines not beginning with '#' that come before
# its tag, but after any other tag (or the beginning of the file).  Tags are
# lines beginning with '# <sub-repo-name>', or '# <*>' for the meta-repo.
# If the tag for a repo is removed, no commit will be generated for that repo.
# If you do not provide a commit message for a sub-repo, the commit
# message for the meta-repo will be used.
`,
            },

            "changes to the meta": {
                input: new RepoStatus({
                    currentBranchName: "foo",
                    staged: {
                        baz: FILESTATUS.ADDED,
                    },
                }),
                expected: `\

# <*> enter meta-repo message above this line; delete to commit only submodules
# On branch foo.
# Changes to be committed:
# \tnew file:     baz
#
# Please enter the commit message(s) for your changes.  The message for a
# repo will be composed of all lines not beginning with '#' that come before
# its tag, but after any other tag (or the beginning of the file).  Tags are
# lines beginning with '# <sub-repo-name>', or '# <*>' for the meta-repo.
# If the tag for a repo is removed, no commit will be generated for that repo.
# If you do not provide a commit message for a sub-repo, the commit
# message for the meta-repo will be used.
`,
            },
            "sub-repo with staged change": {
                input: new RepoStatus({
                    currentBranchName: "foo",
                    submodules: {
                        bar: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("2",
                                                       "/a",
                                                       RELATION.AHEAD),
                        }),
                    },
                }),
                expected: `\

# <*> enter meta-repo message above this line; delete to commit only submodules
# On branch foo.
# Changes to be committed:
# \tmodified:     bar (submodule, new commits)
#
# Please enter the commit message(s) for your changes.  The message for a
# repo will be composed of all lines not beginning with '#' that come before
# its tag, but after any other tag (or the beginning of the file).  Tags are
# lines beginning with '# <sub-repo-name>', or '# <*>' for the meta-repo.
# If the tag for a repo is removed, no commit will be generated for that repo.
# If you do not provide a commit message for a sub-repo, the commit
# message for the meta-repo will be used.
`,
            },
            "sub-repo with just unstaged changes": {
                input: new RepoStatus({
                    currentBranchName: "foo",
                    submodules: {
                        bar: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    workdir: {
                                        foo: FILESTATUS.MODIFIED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: `\

# <*> enter meta-repo message above this line; delete to commit only submodules
# On branch foo.
#
# Please enter the commit message(s) for your changes.  The message for a
# repo will be composed of all lines not beginning with '#' that come before
# its tag, but after any other tag (or the beginning of the file).  Tags are
# lines beginning with '# <sub-repo-name>', or '# <*>' for the meta-repo.
# If the tag for a repo is removed, no commit will be generated for that repo.
# If you do not provide a commit message for a sub-repo, the commit
# message for the meta-repo will be used.
`,
            },
            "sub-repo with staged changes": {
                input: new RepoStatus({
                    currentBranchName: "foo",
                    submodules: {
                        bar: new Submodule({
                            commit: new Submodule.Commit("1", "/a"),
                            index: new Submodule.Index("1",
                                                       "/a",
                                                       RELATION.SAME),
                            workdir: new Submodule.Workdir(
                                new RepoStatus({
                                    headCommit: "1",
                                    staged: {
                                        foo: FILESTATUS.MODIFIED,
                                    },
                                }),
                                RELATION.SAME
                            ),
                        }),
                    },
                }),
                expected: `\

# <*> enter meta-repo message above this line; delete to commit only submodules
# On branch foo.
# -----------------------------------------------------------------------------

# <bar> enter message for 'bar' above this line; delete this line to skip \
committing 'bar'
# Changes to be committed:
# \tmodified:     foo
#
# Please enter the commit message(s) for your changes.  The message for a
# repo will be composed of all lines not beginning with '#' that come before
# its tag, but after any other tag (or the beginning of the file).  Tags are
# lines beginning with '# <sub-repo-name>', or '# <*>' for the meta-repo.
# If the tag for a repo is removed, no commit will be generated for that repo.
# If you do not provide a commit message for a sub-repo, the commit
# message for the meta-repo will be used.
`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                const result = Commit.formatSplitCommitEditorPrompt(c.input);
                const resultLines = result.split("\n");
                const expectedLines = c.expected.split("\n");
                assert.deepEqual(resultLines, expectedLines);
            });
        });
    });

    describe("parseSplitCommitMessages", function () {
        const cases = {
            "trivial": {
                input: "",
                expected: {
                    metaMessage: null,
                    subMessages: {},
                },
            },
            "some meta": {
                input: `\
# just thinking
This is my commit.

and a little more.
# but not this

# or this
# <*>
`,
                expected: {
                    metaMessage: `\
This is my commit.

and a little more.
`,
                    subMessages: {},
                },
            },
            "tag with trail": {
                input: `\
my message
# <*> trailing stuff
`,
                expected: {
                    metaMessage: `my message\n`,
                    subMessages: {},
                },
            },
            "just a sub": {
                input: `\


hello sub
# <my-sub>
`,
                expected: {
                    metaMessage: null,
                    subMessages: {
                        "my-sub": `\
hello sub
`,
                    },
                },
            },
            "double sub": {
                input: `\
# <sub>
# <sub>
`,
                fails: true,
            },
            "sub, no meta": {
                input: "# <sub>\n",
                expected: {
                    metaMessage: null,
                    subMessages: {},
                },
            },
            "inherited sub message": {
                input: `\
meta message
# <*>
# <a-sub>
`,
                expected: {
                    metaMessage: "meta message\n",
                    subMessages: {
                        "a-sub": "meta message\n",
                    },
                },
            },
            "mixed": {
                input: `\
# intro
my meta message
# <*>

my a message
# <a>

# hmm
# <b>

this is for c
# <c>

and for d
# <d>
`,
                expected: {
                    metaMessage: "my meta message\n",
                    subMessages: {
                        a: "my a message\n",
                        b: "my meta message\n",
                        c: "this is for c\n",
                        d: "and for d\n",
                    },
                },
            },
            "empty meta": {
                input: "# <*> meta meta\n",
                fails: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, function () {
                let result;
                try {
                    result = Commit.parseSplitCommitMessages(c.input);
                }
                catch (e) {
                    if (c.fails && (e instanceof UserError)) {
                        return;                                       // RETURN
                    }
                    throw e;
                }
                assert(!c.fails, "should fail");
                assert.deepEqual(result, c.expected);
            });
        });
    });
});
