<!--
    Copyright (c) 2016, Two Sigma Open Source
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.

    * Neither the name of git-meta nor the names of its
      contributors may be used to endorse or promote products derived from
      this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.
-->

# What is git-meta?

## TL;DR

Git-meta allows developers to work with extremely large codebases --
performance does not degrade with increasing physical size, number of files,
number of contributors, or depth of history.  Developers clone only the
subsets of the code that they need, yet can still make atomic commits
across the entire codebase and easily collaborate with others using standard
Git mechanisms.

## A little more detail

Git-meta describes an architecture and provides a set of tools to facilitate
the implementation of a *mono-repo* and attendant workflows.  Aside from the
ability to install the tools provided in this repository, git-meta requires
only Git.  Git-meta is not tied to any specific Git hosting solution, and does
not provide operations that are hosting-solution-specific, such as the ability
to create new (server-side) repositories.

A detailed description of the architecture of Git meta is provided in
[doc/architecture.md](doc/architecture.md).

