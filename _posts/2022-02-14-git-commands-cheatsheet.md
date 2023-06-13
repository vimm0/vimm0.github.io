---
layout: post
title: "Git Commands Cheatsheet"
date: 2022-02-14 10:45:36 +0545
categories: git
---

#### Git Command Cheatsheet

```bash
# When starting work on a new feature, branch off from the develop branch.
git checkout -b myfeature develop

# Finished features may be merged into the develop branch to definitely add them to the upcoming release:

git checkout develop
git merge --no-ff myfeature
git branch -d myfeature
git push origin develop

```

### Reference
- [A successful Git branching model](https://nvie.com/posts/a-successful-git-branching-model/)
- [How to use GIT when working with a team?](https://www.youtube.com/watch?v=jhtbhSpV5YA)