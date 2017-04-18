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

const co = require("co");

/**
 * this module is the entrypoint for the `commit` command.
 */

/**
 * help text for the `commit` command
 *
 * @property {String}
 */
exports.helpText = `Commit modifications in local repositories and the
meta-repository to point to these new commits.`;

/**
 * Configure the specified `parser` for the `commit` command.
 *
 * @param {ArgumentParser} parser
 */
exports.configureParser = function (parser) {
    parser.addArgument(["-a", "--all"], {
        defaultValue: false,
        required: false,
        action: "storeConst",
        constant: true,
        help: "commit all changed files",
    });
    parser.addArgument(["-m", "--message"], {
        type: "string",
        defaultValue: null,
        required: false,
        help: "commit message; if not specified will prompt"
    });
    parser.addArgument(["--meta"], {
        required: false,
        action: "storeConst",
        constant: true,
        help: `
Include changes to the meta-repo; disabled by default to prevent mistakes.`,
        defaultValue: false,
    });
    parser.addArgument(["--amend"], {
        required: false,
        action: "storeConst",
        constant: true,
        help: `\
Amend the last commit, including newly staged chnages and, (if -a is \
specified) modifications.  Will fail unless all submodules changed in HEAD \
have matching commits and have no new commits.`,
    });
    parser.addArgument(["-i", "--interactive"], {
        required: false,
        action: "storeConst",
        constant: true,
        help: `\
Interactively choose which meta- and sub-repositories to commit, and what
message to use with each one.`,
    });
    parser.addArgument(["file"], {
        type: "string",
        help: `\
When files are provided, this command ignores changes staged in the index,
and instead records the current content of the listed files (which must already
be known to Git).  Note that this command is incompatible with  the '-a' option
and submodule configuration changes (i.e., those that add, remove, or change
the URL of submodules).`,
        nargs: "*",
    });
};

function abortForNoMessage() {
    console.error("Aborting commit due to empty commit message.");
    process.exit(1);
}

function errorWithStatus(status, relCwd, message) {
    const colors = require("colors");
    const PrintStatusUtil = require("../util/print_status_util");

    process.stderr.write(PrintStatusUtil.printRepoStatus(status, relCwd));
    console.error(colors.yellow(message));
    process.exit(1);
}

function checkForPathIncompatibleSubmodules(repoStatus, relCwd) {

    const Commit = require("../util/commit");

    if (Commit.areSubmodulesIncompatibleWithPathCommits(repoStatus)) {
            errorWithStatus(repoStatus, relCwd, `\
Cannot use path-based commit on submodules with staged commits or
configuration changes.`);
    }
}

const doCommit = co.wrap(function *(args) {
    const path = require("path");

    const Commit          = require("../util/commit");
    const GitUtil         = require("../util/git_util");
    const PrintStatusUtil = require("../util/print_status_util");

    const repo = yield GitUtil.getCurrentRepo();
    const cwd = process.cwd();
    const workdir = repo.workdir();
    const relCwd = path.relative(workdir, cwd);
    const repoStatus = yield Commit.getCommitStatus(repo,
                                                    cwd, {
        showMetaChanges: args.meta,
        all: args.all,
        paths: args.file,
    });

    // Abort if there are uncommittable submodules; we don't want to commit a
    // .gitmodules file with references to a submodule that doesn't have a
    // commit.
    //
    // TODO: potentially do somthing more intelligent like committing a
    // different versions of .gitmodules than what is on disk to omit
    // "uncommittable" submodules.  Considering that this situation should be
    // relatively rare, I don't think it's worth the additional complexity at
    // this time.

    if (repoStatus.areUncommittableSubmodules()) {
        errorWithStatus(
                  repoStatus,
                  relCwd,
                  "Please stage changes in new submodules before committing.");
    }

    // If we're using paths, the status of what we're committing needs to be
    // calculated.  Also, we need to see if there are any submodule
    // configuration changes.

    const usingPaths = 0 !== args.file.length;

    // If we're doing a path based commit, validate that we are in a supported
    // configuration.

    if (usingPaths) {
        checkForPathIncompatibleSubmodules(repoStatus, relCwd);
    }

    // If there are no staged changes, warn the user and exit early.

    if (repoStatus.isIndexDeepClean()) {
        process.stdout.write(PrintStatusUtil.printRepoStatus(repoStatus,
                                                             relCwd));
        return;
    }

    let message = args.message;
    let subMessages;

    if (args.interactive) {
        // If 'interactive' mode is requested, ask the user to specify which
        // repos are committed and with what commit messages.

        const prompt = Commit.formatSplitCommitEditorPrompt(repoStatus);
        const userText = yield GitUtil.editMessage(repo, prompt);
        const userData = Commit.parseSplitCommitMessages(userText);
        message = userData.metaMessage;
        subMessages = userData.subMessages;
    }
    else if (null === message) {
        // If no message on the command line, prompt for one.

        const initialMessage = Commit.formatEditorPrompt(repoStatus, cwd);
        const rawMessage = yield GitUtil.editMessage(repo, initialMessage);
        message = GitUtil.stripMessage(rawMessage);
    }

    if ("" === message) {
        abortForNoMessage();
    }

    if (usingPaths) {
        yield Commit.commitPaths(repo, repoStatus, message, subMessages);
    }
    else {
        yield Commit.commit(repo, args.all, repoStatus, message, subMessages);
    }
});

const doAmend = co.wrap(function *(args) {
    const colors = require("colors");
    const path   = require("path");

    const Commit          = require("../util/commit");
    const GitUtil         = require("../util/git_util");
    const PrintStatusUtil = require("../util/print_status_util");
    const SubmoduleUtil   = require("../util/submodule_util");
    const UserError       = require("../util/user_error");

    const usingPaths = 0 !== args.file.length;

    if (usingPaths) {
        throw new UserError("Paths not supported with amend yet.");
    }

    if (args.interactive) {
        throw new UserError(`\
TODO: interactive commits are not yet supported with '--amend'.`);
    }

    const repo = yield GitUtil.getCurrentRepo();
    const cwd = process.cwd();
    const workdir = repo.workdir();
    const relCwd = path.relative(workdir, cwd);
    let status = yield Commit.getCommitStatus(repo,
                                              cwd, {
        showMetaChanges: args.meta,
        all: args.all,
        paths: args.file,
    });

    const head = yield repo.getHeadCommit();

    // Load up the set of submodules in existence on the previous commit, if
    // any.

    let oldSubs = {};
    const parent = yield GitUtil.getParentCommit(repo, head);
    if (null !== parent) {
        oldSubs = yield SubmoduleUtil.getSubmodulesForCommit(repo, parent);
    }

    // Check to see if the repo is in a valid state to be amended.

    const amendable = yield Commit.checkIfRepoIsAmendable(repo,
                                                          status,
                                                          oldSubs);
    let bad = "";
    Object.keys(amendable.newCommits).forEach(sub => {
        const relation = amendable.newCommits[sub];
        const description = PrintStatusUtil.getRelationDescription(relation);
        bad += `${colors.red(sub)} : ${description}`;
    });
    amendable.mismatchCommits.forEach(sub => {
        bad += `The commit for ${colors.red(sub)} does not match.`;
    });
    amendable.deleted.forEach(sub => {
        bad += `${colors.red(sub)} was deleted.\n`;
    });
    if ("" !== bad) {
        throw new UserError("Cannot make amend commit:\n" + bad);
    }

    // May have opened repos, so we need to update 'status'.

    status = amendable.status;

    // Calculate the changes that will be made by this amend -- so we know:
    // (a) which subs to amend
    // (b) what changes to stage (if any)
    // (c) if an editor prompt is required, what information to display

    const amendChanges = yield Commit.getAmendChanges(repo,
                                                      oldSubs,
                                                      status,
                                                      args.meta,
                                                      args.all);

    // Update 'status' to reflect changes to be applied with amend.

    status = amendChanges.status;

    // If no message, use editor.

    if (null === args.message) {
        const headSig = head.author();
        const time = headSig.when();
        const date = new Date(time.time() * 1000);
        const defaultSig = repo.defaultSignature();
        const statusMessage = Commit.formatAmendEditorPrompt(headSig,
                                                             defaultSig,
                                                             status,
                                                             relCwd,
                                                             `${date}`);
        const initialMessage = head.message() + statusMessage;
        const rawMessage = yield GitUtil.editMessage(repo, initialMessage);
        args.message = GitUtil.stripMessage(rawMessage);
    }

    if ("" === args.message) {
        abortForNoMessage();
    }

    // Finally, perform the operation.

    yield Commit.amendMetaRepo(repo,
                               status,
                               amendChanges.subsToAmend,
                               args.all,
                               args.message);
});

/**
 * Exeucte the `commit` command according to the specified `args`.
 *
 * @async
 * @param {Object}  args
 * @param {Boolean} args.all
 * @param {String}  [args.message]
 */
exports.executeableSubcommand = function (args) {
    if (args.all && 0 !== args.file.length) {
        console.error("The use of '-a' and files does not make sense.");
        process.exit(1);
    }
    if (args.message && args.interactive) {
        console.error("The use of '-i' and '-m' does not make sense.");
        process.exit(1);
    }
    if (args.amend) {
        return doAmend(args);                                         // RETURN
    }
    return doCommit(args);
};
