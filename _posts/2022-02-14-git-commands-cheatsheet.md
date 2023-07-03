---
layout: post
title: "Git Commands Cheatsheet"
date: 2022-02-14 10:45:36 +0545
categories: git
---

## Git Command Cheatsheet

```bash
# When starting work on a new feature, branch off from the develop branch.
git checkout -b myfeature develop

# Finished features may be merged into the develop branch to definitely add them to the upcoming release:

git checkout develop
git merge --no-ff myfeature
git branch -d myfeature
git push origin develop

```

## Commands

| Command | Description |
|---------|-------------|
| `git init` | Initializes a new Git repository in the current directory. |
| `git clone <repository>` | Creates a local copy of a remote repository. |
| `git status` | Shows the current status of the repository. |
| `git add <file>` | Adds a file to the staging area for the next commit. |
| `git commit -m "message"` | Records the changes in the repository with a descriptive message. |
| `git diff` | Shows the differences between the working directory and the staging area. |
| `git log` | Displays the commit history of the repository. |
| `git branch` | Lists all branches in the repository. |
| `git checkout <branch>` | Switches to the specified branch. |
| `git merge <branch>` | Combines changes from the specified branch into the current branch. |
| `git pull` | Fetches changes from a remote repository and merges them into the current branch. |
| `git push` | Pushes the local commits to a remote repository. |
| `git remote add <name> <url>` | Adds a new remote repository with the given name and URL. |
| `git remote -v` | Lists all remote repositories associated with the current repository. |
| `git stash` | Temporarily saves changes that are not ready to be committed. |
| `git reset <file>` | Removes a file from the staging area. |
| `git revert <commit>` | Reverts the specified commit by creating a new commit. |
| `git fetch` | Downloads changes from a remote repository without merging them. |
| `git tag` | Lists all tags in the repository. |
| `git show <commit>` | Displays information about the specified commit. |


## Reference
- [A successful Git branching model](https://nvie.com/posts/a-successful-git-branching-model/)
- [How to use GIT when working with a team?](https://www.youtube.com/watch?v=jhtbhSpV5YA)