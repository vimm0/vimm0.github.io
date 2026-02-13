---
layout: post
title: "Useful Git Commands for Team Collaboration"
date: 2026-02-13 00:00:00 +0000
categories: git
---

Working in a team environment requires a slightly different set of Git skills compared to working alone. You need to manage branches effectively, handle conflicts, and keep your local repository in sync with your teammates. Here are some essential Git commands and workflows for team collaboration.

## 1. Getting Started

When joining a project, you first need to get the code:

```bash
git clone <repository_url>
```

## 2. Branch Management

**Never work directly on the `main` (or `master`) branch.** Always create a feature branch for your work. This keeps the main branch stable.

```bash
# Create and switch to a new branch
git checkout -b feature/my-new-feature
```

To list all branches and see which one you are currently on:

```bash
git branch
```

## 3. Staying Updated

Before you start working, and regularly while you work, you should pull the latest changes from the remote repository to minimize conflicts.

```bash
# Switch to main to update it
git checkout main
git pull origin main

# Switch back to your feature branch and merge main into it
git checkout feature/my-new-feature
git merge main
```

*Alternatively, you can use `git rebase` for a cleaner history, but be careful with shared branches.*

## 4. Saving Your Work

As you make changes:

```bash
# See what has changed
git status

# Stage files for commit
git add <filename> 
# OR add all changed files
git add .

# Commit with a meaningful message
git commit -m "feat: add user login functionality"
```

## 5. Sharing Your Changes

When you are ready to share your work or create a Pull Request (PR):

```bash
# Push your branch to the remote repository
git push -u origin feature/my-new-feature
```

The `-u` flag sets the upstream, so in the future, you can just type `git push` while on that branch.

## 6. Collaborating on a Teammate's Branch

Sometimes a teammate asks for help on their feature branch, or you need to test their changes locally. Let's say the branch is named `feature-x`.

First, make sure your local repository knows about all the branches on the remote:

```bash
git fetch origin
```

You can see all available remote branches (and other info) with:

```bash
git remote show origin
```

To work on their branch, create a local copy that tracks the remote branch:

```bash
git checkout -b feature-x origin/feature-x
```

Now you are on a local branch named `feature-x` which is connected to the remote `origin/feature-x`.

## 7. Handling Context Switches

If your teammate needs you to check something on another branch, but you have unfinished work:

```bash
# Stash your changes (saves them temporarily)
git stash

# Switch branches
git checkout other-branch

# ... do what you need to do ...

# Come back
git checkout feature/my-new-feature

# Restore your stashed changes
git stash pop
```

## 8. Troubleshooting & History

Sometimes you need to see who changed what or review history:

```bash
# See commit history
git log --oneline --graph --all

# See who modified each line of a file (blame)
git blame <filename>
```

## Summary Checklist for Teams

1.  **Clone** the repo.
2.  **Branch** off `main`.
3.  **Commit** often.
4.  **Pull** `main` regularly into your branch.
5.  **Push** your branch and open a PR.

Using these commands effectively will make your team collaboration much smoother and conflict-free!
